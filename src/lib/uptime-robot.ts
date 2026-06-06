import type {
  FormattedMonitor,
  Incident,
  MonitorLog,
  OverallStatus,
  V3MonitorListItem,
  V3UptimeStats,
  V3ResponseTimeStats,
  V3IncidentItem,
} from "./types";
import { v3StatusToInternal, v3StatusToLabel, LOG_TYPE } from "./types";

// ============================================================
// 常量
// ============================================================

const API_BASE = "https://api.uptimerobot.com/v3";

/**
 * 为遵守 UptimeRobot v3 API rate limit（免费版 10 req/min），
 * 请求间最少间隔 1 秒。并发数设 1 → 完全串行。
 */
const INTER_REQUEST_DELAY_MS = 1000;

// ============================================================
// 工具函数
// ============================================================

function toNum(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

/** ISO 8601 字符串 → Unix 时间戳（秒） */
function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** 返回 N 天前的 ISO 8601 字符串 */
function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// 服务端内存缓存（存活在 warm function instance 中）
// ============================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const g = globalThis as Record<string, unknown>;

function cacheGet<T>(key: string): T | null {
  const store = (g.__uptimeCache as Record<string, CacheEntry<T>>) || {};
  g.__uptimeCache = store;
  const entry = store[key];
  if (entry && Date.now() - entry.timestamp < 5 * 60 * 1000) {
    return entry.data;
  }
  return null;
}

function cacheSet<T>(key: string, data: T): void {
  const store = (g.__uptimeCache as Record<string, CacheEntry<T>>) || {};
  store[key] = { data, timestamp: Date.now() };
  g.__uptimeCache = store;
}

// ============================================================
// v3 API 调用（每个函数都自带 fetch 缓存 + 429 重试）
// ============================================================

async function v3Fetch<T>(
  url: string,
  jwt: string,
  revalidateSeconds: number,
  retries = 2,
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: revalidateSeconds },
    });

    if (res.ok) return res.json() as Promise<T>;

    if (res.status === 429 && attempt < retries) {
      // Rate limited → 指数退避重试
      const backoff = Math.pow(2, attempt + 2) * 1000; // 4s, 8s, ...
      console.warn(`[uptime-robot] 429 rate limited, retrying in ${backoff / 1000}s (attempt ${attempt + 1}/${retries})`);
      await delay(backoff);
      continue;
    }

    const body = await res.text().catch(() => "");
    throw new Error(
      `${res.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
    );
  }
  throw new Error("Max retries exceeded");
}

/** Step 1: 获取全量 monitor 列表 */
async function fetchMonitorList(jwt: string): Promise<V3MonitorListItem[]> {
  const json = await v3Fetch<{ nextLink: string | null; data: V3MonitorListItem[] }>(
    `${API_BASE}/monitors?limit=200`,
    jwt,
    30,
  );
  if (json.nextLink) {
    console.warn(
      "[uptime-robot] Monitor count exceeds 200 (pagination detected).",
    );
  }
  return json.data ?? [];
}

/** Step 2a: 获取单个 monitor 的 uptime 统计 */
async function fetchUptimeStats(
  jwt: string,
  monitorId: number,
  days: number,
): Promise<V3UptimeStats> {
  const params = new URLSearchParams({
    from: daysAgoISO(days),
    to: new Date().toISOString(),
  });
  return v3Fetch<V3UptimeStats>(
    `${API_BASE}/monitors/${monitorId}/stats/uptime?${params}`,
    jwt,
    300, // 5 分钟缓存
  );
}

/** Step 2b: 获取单个 monitor 的响应时间统计（含时间序列） */
async function fetchResponseTimeStats(
  jwt: string,
  monitorId: number,
): Promise<V3ResponseTimeStats> {
  const params = new URLSearchParams({
    from: daysAgoISO(1),
    to: new Date().toISOString(),
    includeTimeSeries: "true",
  });
  return v3Fetch<V3ResponseTimeStats>(
    `${API_BASE}/monitors/${monitorId}/stats/response-time?${params}`,
    jwt,
    300,
  );
}

/** Step 3: 获取过去 90 天的宕机事件 */
async function fetchIncidents(jwt: string): Promise<V3IncidentItem[]> {
  const params = new URLSearchParams({
    started_after: daysAgoISO(90),
    limit: "50",
  });
  const json = await v3Fetch<{ nextLink: string | null; data: V3IncidentItem[] }>(
    `${API_BASE}/incidents?${params}`,
    jwt,
    300,
  );
  return json.data ?? [];
}

// ============================================================
// 主入口
// ============================================================

/**
 * 使用 v3 REST API 获取全部 monitor 及详细 stats。
 *
 * 调用策略（遵守 10 req/min rate limit）：
 *   1. GET /monitors?limit=200                             → 1 次
 *   2. 串行调用（间隔 1s）每个 monitor 的 uptime (×3) + response-time (×1)
 *   3. GET /incidents?started_after=90d&limit=50          → 1 次
 *
 * 结果缓存在服务端内存（globalThis）5 分钟，
 * 每个 fetch 额外有 Next.js Data Cache 兜底。
 */
export async function fetchMonitors(
  jwt: string,
): Promise<FormattedMonitor[]> {
  // ── 检查内存缓存 ──────────────────────────────────────────
  const cached = cacheGet<FormattedMonitor[]>("monitors");
  if (cached) return cached;

  // ── Step 1: 获取 monitor 列表 ──────────────────────────────
  const monitorItems = await fetchMonitorList(jwt);

  if (monitorItems.length === 0) {
    const empty: FormattedMonitor[] = [];
    cacheSet("monitors", empty);
    return empty;
  }

  // 构建 FormattedMonitor 骨架（stats 待填充）
  const monitors: FormattedMonitor[] = monitorItems.map((item) => ({
    id: item.id,
    name: item.friendlyName,
    url: item.url,
    status: v3StatusToInternal(item.status),
    statusLabel: v3StatusToLabel(item.status),
    monitorType: String(item.type),
    interval: item.interval,
    uptimeRatios: { ratio7d: 100, ratio30d: 100, ratio90d: 100 },
    averageResponseTime: 0,
    logs: [],
    responseTimes: [],
    downEvents: [],
  }));

  // ── Step 2: 串行获取每个 monitor 的 stats ──────────────────
  // 每个 monitor：3 次 uptime + 1 次 response-time = 4 次串行调用
  // monitor 之间也串行，每次调用间隔 >=1s，确保不超 10 req/min
  for (const mon of monitors) {
    // uptime stats (7d / 30d / 90d) — 串行，间隔 1s
    try {
      mon.uptimeRatios.ratio7d = (await fetchUptimeStats(jwt, mon.id, 7)).uptime;
    } catch (e) {
      console.warn(`[uptime-robot] uptime 7d failed for ${mon.name}:`, e);
    }
    await delay(INTER_REQUEST_DELAY_MS);

    try {
      mon.uptimeRatios.ratio30d = (await fetchUptimeStats(jwt, mon.id, 30)).uptime;
    } catch (e) {
      console.warn(`[uptime-robot] uptime 30d failed for ${mon.name}:`, e);
    }
    await delay(INTER_REQUEST_DELAY_MS);

    try {
      mon.uptimeRatios.ratio90d = (await fetchUptimeStats(jwt, mon.id, 90)).uptime;
    } catch (e) {
      console.warn(`[uptime-robot] uptime 90d failed for ${mon.name}:`, e);
    }
    await delay(INTER_REQUEST_DELAY_MS);

    // response time
    try {
      const rt = await fetchResponseTimeStats(jwt, mon.id);
      mon.averageResponseTime = Math.round(rt.summary.avg);
      mon.responseTimes = (rt.time_series || []).map((ts) => ({
        datetime: isoToUnix(ts.datetime),
        value: toNum(ts.value),
      }));
    } catch (e) {
      console.warn(`[uptime-robot] response-time failed for ${mon.name}:`, e);
    }
    await delay(INTER_REQUEST_DELAY_MS);
  }

  // ── Step 3: 获取 incidents（宕机事件） ─────────────────────
  try {
    const incidents = await fetchIncidents(jwt);

    for (const inc of incidents) {
      const mon = monitors.find((m) => m.id === inc.monitor.id);
      if (!mon) continue;
      if (inc.type !== "DOWNTIME") continue;

      const log: MonitorLog = {
        id: parseInt(inc.id, 10) || 0,
        type: LOG_TYPE.DOWN,
        datetime: isoToUnix(inc.startedAt),
        duration: inc.duration ?? 0,
        reason: inc.reason
          ? { code: "DOWNTIME", detail: inc.reason }
          : undefined,
      };

      mon.logs.push(log);
      mon.downEvents.push(log);
    }
  } catch (e) {
    console.warn("[uptime-robot] Failed to fetch incidents:", e);
  }

  // ── 写入内存缓存 ──────────────────────────────────────────
  cacheSet("monitors", monitors);

  return monitors;
}

// ============================================================
// 工具函数（与 API 版本无关）
// ============================================================

export function getOverallStatus(monitors: FormattedMonitor[]): OverallStatus {
  const down = monitors.filter((m) => m.status === 8 || m.status === 9);
  const paused = monitors.filter((m) => m.status === 0);

  if (down.length === monitors.length && monitors.length > 0) {
    return { status: "down", label: "全部服务宕机" };
  }
  if (down.length > 0) {
    return { status: "degraded", label: `${down.length} 个服务异常` };
  }
  if (paused.length > 0) {
    return {
      status: "operational",
      label: "运行正常 · 部分服务暂停中",
    };
  }
  return { status: "operational", label: "所有服务运行正常" };
}

export function getIncidents(monitors: FormattedMonitor[]): Incident[] {
  const incidents: Incident[] = [];

  for (const monitor of monitors) {
    for (const log of monitor.downEvents) {
      const now = Math.floor(Date.now() / 1000);
      incidents.push({
        id: log.id,
        monitorId: monitor.id,
        monitorName: monitor.name,
        monitorUrl: monitor.url,
        datetime: log.datetime,
        duration: log.duration,
        isOngoing: log.duration === 0 && now - log.datetime < 86400,
        reason: log.reason?.detail,
      });
    }
  }

  incidents.sort((a, b) => b.datetime - a.datetime);
  return incidents.slice(0, 50);
}
