import type {
  FormattedMonitor,
  Incident,
  MonitorLog,
  OverallStatus,
  UptimeRatios,
  V3MonitorListItem,
  V3ResponseTimeStats,
  V3IncidentItem,
} from "./types";
import { v3StatusToInternal, v3StatusToLabel, LOG_TYPE } from "./types";

// ============================================================
// 常量
// ============================================================

const API_BASE = "https://api.uptimerobot.com/v3";

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

function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// Uptime 比率计算（基于 incidents 的 downtime 时长）
// ============================================================

/**
 * 从 incidents 列表计算指定时间窗口的 uptime 比率。
 * 正确处置跨窗口边界的事件（只统计落在窗口内的时长）。
 */
function calcUptimeFromIncidents(
  incidents: V3IncidentItem[],
  days: number,
  now: number,
): number {
  const periodStart = now - days * 24 * 3600;
  const periodSeconds = days * 24 * 3600;

  let totalDowntime = 0;

  for (const inc of incidents) {
    if (inc.type?.toLowerCase() !== "downtime") continue;

    const start = isoToUnix(inc.startedAt);
    const end = inc.resolvedAt ? isoToUnix(inc.resolvedAt) : now;

    // 统计与当前窗口的重叠时长
    const overlapStart = Math.max(start, periodStart);
    const overlapEnd = Math.min(end, now);
    if (overlapStart < overlapEnd) {
      totalDowntime += overlapEnd - overlapStart;
    }
  }

  return Math.max(0, ((periodSeconds - totalDowntime) / periodSeconds) * 100);
}

// ============================================================
// 服务端内存缓存（globalThis，存活在 warm instance 中）
// ============================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

function cacheGet<T>(key: string): CacheEntry<T> | null {
  const store = (globalThis as Record<string, unknown>).__uptimeCache as
    | Record<string, CacheEntry<T>>
    | undefined;
  if (!store) return null;
  return store[key] ?? null;
}

function cacheSet<T>(key: string, data: T): void {
  const g = globalThis as Record<string, unknown>;
  if (!g.__uptimeCache) g.__uptimeCache = {};
  (g.__uptimeCache as Record<string, CacheEntry<T>>)[key] = {
    data,
    timestamp: Date.now(),
  };
}

/** 缓存是否在 TTL 内 */
function isFresh(entry: CacheEntry<unknown> | null, ttlMs: number): boolean {
  return !!entry && Date.now() - entry.timestamp < ttlMs;
}

/** 是否有可用的旧数据（用于 stale-while-revalidate） */
function isStale(entry: CacheEntry<unknown> | null, ttlMs: number): boolean {
  return !!entry && Date.now() - entry.timestamp < ttlMs * 3;
}

// ============================================================
// v3 API 调用（带 429 重试 + 通用错误处理）
// ============================================================

/**
 * 所有 v3 API 请求的通用封装：
 * - 自动附加 JWT 认证头
 * - 429 时指数退避重试（最多 3 次：2s/4s/8s）
 * - 返回已解析的 JSON
 */
async function v3Fetch<T>(
  url: string,
  jwt: string,
): Promise<T> {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const fetchOpts: RequestInit = {
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
    };
    // 注意：API Route 中 Next.js Data Cache 不可用，仅依赖 globalThis 缓存

    const res = await fetch(url, fetchOpts);

    if (res.ok) return res.json() as Promise<T>;

    if (res.status === 429 && attempt < maxRetries) {
      const backoff = Math.pow(2, attempt + 1) * 5000; // 10s, 20s, 40s
      console.warn(
        `[uptime-robot] 429 on ${url.split("?")[0].split("/v3")[1]}, ` +
          `retry in ${backoff / 1000}s (${attempt + 1}/${maxRetries})`,
      );
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

/** 获取全量 monitor 列表 */
async function fetchMonitorList(jwt: string): Promise<V3MonitorListItem[]> {
  const json = await v3Fetch<{ nextLink: string | null; data: V3MonitorListItem[] }>(
    `${API_BASE}/monitors?limit=200`,
    jwt,
  );
  return json.data ?? [];
}

/** 获取过去 90 天的全部 incidents（v3 无 limit 参数，依赖默认分页） */
async function fetchAllIncidents(jwt: string): Promise<V3IncidentItem[]> {
  const url = `${API_BASE}/incidents?started_after=${encodeURIComponent(daysAgoISO(90))}`;
  const json = await v3Fetch<{ nextLink: string | null; data: V3IncidentItem[] }>(
    url,
    jwt,
  );

  const all = [...(json.data ?? [])];

  // 分页（最多额外 2 页）
  let nextUrl = json.nextLink;
  let extraPages = 0;
  while (nextUrl && extraPages < 2) {
    await delay(1000);
    const page = await v3Fetch<{ nextLink: string | null; data: V3IncidentItem[] }>(
      nextUrl,
      jwt,
    );
    all.push(...(page.data ?? []));
    nextUrl = page.nextLink;
    extraPages++;
  }

  return all;
}

/** 获取单个 monitor 的响应时间 */
async function fetchOneResponseTime(
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
  );
}

// ============================================================
// 请求去重（同一时刻只允许一个 in-flight 请求）
// ============================================================

const g = globalThis as Record<string, unknown>;
let inflightPromise: Promise<FormattedMonitor[]> | null =
  (g.__uptimeInflight as Promise<FormattedMonitor[]> | null) || null;

// ============================================================
// 主入口：2 次 API 调用 + 本地计算 uptime
// ============================================================

/**
 * 使用 v3 API 获取全部数据。
 *
 * 缓存策略（三级）：
 *   FRESH  (< 10 min)：直接返回，零 API 调用
 *   STALE  (10-30 min)：返回旧数据 + 后台异步刷新（不阻塞）
 *   COLD   (> 30 min / 未缓存)：阻塞刷新，同时去重并发请求
 *
 * 响应时间独立缓存 60 分钟。
 */
export async function fetchMonitors(
  jwt: string,
): Promise<FormattedMonitor[]> {
  const MONITORS_TTL = 30 * 60 * 1000; // 30 分钟

  // ── Tier 1: FRESH 缓存 → 秒返 ─────────────────────────────
  const entry = cacheGet<FormattedMonitor[]>("monitors");
  if (isFresh(entry, MONITORS_TTL) && entry) {
    fillResponseTimesAsync(jwt, entry.data);
    return entry.data;
  }

  // ── Tier 2: STALE 缓存 → 先返旧数据，后台刷新 ──────────────
  if (isStale(entry, MONITORS_TTL) && entry) {
    // 后台刷新（不 await，不阻塞）
    refreshInBackground(jwt);
    fillResponseTimesAsync(jwt, entry.data);
    return entry.data;
  }

  // ── Tier 3: COLD → 必须刷新，但先去重 ─────────────────────
  if (inflightPromise) {
    console.log("[uptime-robot] Dedup: waiting for in-flight request");
    return inflightPromise;
  }

  inflightPromise = doFetchMonitors(jwt);
  g.__uptimeInflight = inflightPromise;

  try {
    const result = await inflightPromise;
    return result;
  } finally {
    inflightPromise = null;
    g.__uptimeInflight = null;
  }
}

/** 实际执行 API 调用的内部函数 */
async function doFetchMonitors(jwt: string): Promise<FormattedMonitor[]> {
  // ── Step 1 + 2：串行获取（不同时发送以避免触发 rate limit）──
  const monitorItems = await fetchMonitorList(jwt);
  await delay(1000);
  const allIncidents = await fetchAllIncidents(jwt);

  const now = Math.floor(Date.now() / 1000);

  // ── 构建 FormattedMonitor（uptime 从 incidents 本地计算）───
  const monitors: FormattedMonitor[] = monitorItems.map((item) => {
    const monIncidents = allIncidents.filter(
      (inc) =>
        inc.monitor.id === item.id &&
        inc.type?.toLowerCase() === "downtime",
    );

    const uptimeRatios: UptimeRatios = {
      ratio7d: calcUptimeFromIncidents(monIncidents, 7, now),
      ratio30d: calcUptimeFromIncidents(monIncidents, 30, now),
      ratio90d: calcUptimeFromIncidents(monIncidents, 90, now),
    };

    const downEvents: MonitorLog[] = monIncidents.map((inc) => ({
      id: parseInt(inc.id, 10) || 0,
      type: LOG_TYPE.DOWN,
      datetime: isoToUnix(inc.startedAt),
      duration: inc.duration ?? 0,
      reason: inc.reason
        ? { code: "DOWNTIME", detail: inc.reason }
        : undefined,
    }));

    return {
      id: item.id,
      name: item.friendlyName,
      url: item.url,
      status: v3StatusToInternal(item.status),
      statusLabel: v3StatusToLabel(item.status),
      monitorType: String(item.type),
      interval: item.interval,
      uptimeRatios,
      averageResponseTime: 0,
      logs: downEvents,
      responseTimes: [],
      downEvents,
    };
  });

  cacheSet("monitors", monitors);

  // ── 响应时间：从缓存恢复或首次拉取 ─────────────────────────
  await fillResponseTimes(jwt, monitors);

  return monitors;
}

/** 后台异步刷新（不阻塞当前请求） */
let bgRefreshRunning = false;
async function refreshInBackground(jwt: string): Promise<void> {
  if (bgRefreshRunning || inflightPromise) return;
  bgRefreshRunning = true;
  try {
    console.log("[uptime-robot] Background refresh started");
    await doFetchMonitors(jwt);
  } catch (e) {
    console.warn("[uptime-robot] Background refresh failed:", e);
  } finally {
    bgRefreshRunning = false;
  }
}

// ============================================================
// 响应时间（独立缓存，60 分钟 TTL）
// ============================================================

const RT_TTL = 120 * 60 * 1000; // 2 小时

interface CachedRT {
  responseTimes: { datetime: number; value: number }[];
  averageResponseTime: number;
}

async function fillResponseTimes(
  jwt: string,
  monitors: FormattedMonitor[],
): Promise<void> {
  // 尝试从独立缓存恢复（FRESH + STALE 都可接受）
  const rtEntry = cacheGet<Record<number, CachedRT>>("responseTimes");
  const rtCache: Record<number, CachedRT> =
    isStale(rtEntry, RT_TTL) && rtEntry ? rtEntry.data : {};

  let restored = 0;
  for (const mon of monitors) {
    const cached = rtCache[mon.id];
    if (cached) {
      mon.responseTimes = cached.responseTimes;
      mon.averageResponseTime = cached.averageResponseTime;
      restored++;
    }
  }

  // FRESH 且全命中 → 零 API 调用
  if (restored === monitors.length && isFresh(rtEntry, RT_TTL)) return;

  // STALE 但全命中 → 返回旧数据，后台补拉
  if (restored === monitors.length) {
    fillResponseTimesAsync(jwt, monitors);
    return;
  }

  // 缓存缺失 → 串行拉取（每秒 1 次，遵守 rate limit）
  const fresh: Record<number, CachedRT> = { ...rtCache };

  for (const mon of monitors) {
    if (rtCache[mon.id]) continue; // 已从缓存恢复

    try {
      const rt = await fetchOneResponseTime(jwt, mon.id);
      const tsData = rt.time_series || [];
      const data: CachedRT = {
        responseTimes: tsData.map((ts, idx) => ({
          // v3 可能返回 null datetime，用合成时间戳兜底
          datetime: ts.datetime
            ? isoToUnix(ts.datetime)
            : Math.floor(Date.now() / 1000) - (tsData.length - 1 - idx) * 300,
          value: toNum(ts.value),
        })),
        averageResponseTime: Math.round(rt.summary.avg),
      };

      mon.responseTimes = data.responseTimes;
      mon.averageResponseTime = data.averageResponseTime;
      fresh[mon.id] = data;

      // 请求间间隔：遵守 rate limit
      await delay(1000);
    } catch (e) {
      console.warn(
        `[uptime-robot] Response time fetch failed for ${mon.name}:`,
        e,
      );
    }
  }

  cacheSet("responseTimes", fresh);
}

/**
 * 异步补拉响应时间（不阻塞主请求）。
 * 在缓存命中的请求中调用，静默刷新过期数据。
 */
let rtRefreshRunning = false;

async function fillResponseTimesAsync(
  jwt: string,
  monitors: FormattedMonitor[],
): Promise<void> {
  if (rtRefreshRunning) return;
  rtRefreshRunning = true;

  try {
    const rtCache =
      cacheGet<Record<number, CachedRT>>("responseTimes")?.data || {};

    const missing = monitors.filter((m) => !rtCache[m.id]);
    if (missing.length === 0) {
      rtRefreshRunning = false;
      return;
    }

    const fresh: Record<number, CachedRT> = { ...rtCache };

    for (const mon of missing) {
      try {
        const rt = await fetchOneResponseTime(jwt, mon.id);
        fresh[mon.id] = {
          responseTimes: (rt.time_series || []).map((ts) => ({
            datetime: isoToUnix(ts.datetime),
            value: toNum(ts.value),
          })),
          averageResponseTime: Math.round(rt.summary.avg),
        };
        await delay(1000);
      } catch {
        // 静默失败
      }
    }

    cacheSet("responseTimes", fresh);
  } finally {
    rtRefreshRunning = false;
  }
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
