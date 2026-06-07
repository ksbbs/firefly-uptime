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

// 基础数据（monitors + incidents）的 Next Data Cache TTL
// Vercel 上跨冷启动持久化，秒级冷启动响应
const BASE_REVALIDATE = 60; // 60s

// 响应时间的 Next Data Cache TTL
// 单个端点限流 + FREE plan 10 req/min，缓存久一点
const RT_REVALIDATE = 30 * 60; // 30 分钟

// FREE plan 限制：10 req/min（滚动窗口）。
// 冷启动峰值：2 base（并行）+ N RT（间隔 8s）。
// 60s 内最多：2 + 7 = 9 次，留 1 次余量。
const RT_INTERVAL_MS = 8000;

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

    const overlapStart = Math.max(start, periodStart);
    const overlapEnd = Math.min(end, now);
    if (overlapStart < overlapEnd) {
      totalDowntime += overlapEnd - overlapStart;
    }
  }

  return Math.max(0, ((periodSeconds - totalDowntime) / periodSeconds) * 100);
}

// ============================================================
// globalThis 内存缓存（warm instance 内复用，比 Next Data Cache 更快）
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

function isFresh(entry: CacheEntry<unknown> | null, ttlMs: number): boolean {
  return !!entry && Date.now() - entry.timestamp < ttlMs;
}

function isStale(entry: CacheEntry<unknown> | null, ttlMs: number): boolean {
  return !!entry && Date.now() - entry.timestamp < ttlMs * 3;
}

// ============================================================
// v3 API 调用（带 Next Data Cache + 429 重试）
// ============================================================

/**
 * Next.js fetch 自带 Vercel Data Cache：通过 next.revalidate 跨冷启动复用。
 * 第二次冷启动直接命中边缘缓存，绕开 Uptime Robot 的限流和延迟。
 */
async function v3Fetch<T>(
  url: string,
  jwt: string,
  revalidate: number,
): Promise<T> {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      next: { revalidate },
    });

    if (res.ok) return res.json() as Promise<T>;

    if (res.status === 429 && attempt < maxRetries) {
      const backoff = Math.pow(2, attempt + 1) * 5000;
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

async function fetchMonitorList(jwt: string): Promise<V3MonitorListItem[]> {
  const json = await v3Fetch<{ nextLink: string | null; data: V3MonitorListItem[] }>(
    `${API_BASE}/monitors?limit=200`,
    jwt,
    BASE_REVALIDATE,
  );
  return json.data ?? [];
}

async function fetchAllIncidents(jwt: string): Promise<V3IncidentItem[]> {
  const url = `${API_BASE}/incidents?started_after=${encodeURIComponent(daysAgoISO(90))}`;
  const json = await v3Fetch<{ nextLink: string | null; data: V3IncidentItem[] }>(
    url,
    jwt,
    BASE_REVALIDATE,
  );

  const all = [...(json.data ?? [])];

  let nextUrl = json.nextLink;
  let extraPages = 0;
  while (nextUrl && extraPages < 2) {
    await delay(1000);
    const page = await v3Fetch<{ nextLink: string | null; data: V3IncidentItem[] }>(
      nextUrl,
      jwt,
      BASE_REVALIDATE,
    );
    all.push(...(page.data ?? []));
    nextUrl = page.nextLink;
    extraPages++;
  }

  return all;
}

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
    RT_REVALIDATE,
  );
}

// ============================================================
// 请求去重
// ============================================================

const g = globalThis as Record<string, unknown>;
let inflightPromise: Promise<FormattedMonitor[]> | null =
  (g.__uptimeInflight as Promise<FormattedMonitor[]> | null) || null;

// ============================================================
// 主入口：基础数据并行拉取，响应时间永不阻塞冷启动
// ============================================================

const MONITORS_TTL = 30 * 60 * 1000;

/**
 * 缓存策略：
 *   FRESH (< 30 min)：直接返，零 API 调用
 *   STALE (30-90 min)：返旧数据 + 后台刷新
 *   COLD (> 90 min / 冷启动)：阻塞拉取（仅 monitors+incidents 并行），响应时间异步填充
 *
 * 关键变化：响应时间从来不在主路径上阻塞，最坏情况冷启动只等 1 次 API 往返。
 */
export async function fetchMonitors(
  jwt: string,
): Promise<FormattedMonitor[]> {
  const entry = cacheGet<FormattedMonitor[]>("monitors");

  if (isFresh(entry, MONITORS_TTL) && entry) {
    fillResponseTimesAsync(jwt, entry.data);
    return entry.data;
  }

  if (isStale(entry, MONITORS_TTL) && entry) {
    refreshInBackground(jwt);
    fillResponseTimesAsync(jwt, entry.data);
    return entry.data;
  }

  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = doFetchMonitors(jwt);
  g.__uptimeInflight = inflightPromise;

  try {
    return await inflightPromise;
  } finally {
    inflightPromise = null;
    g.__uptimeInflight = null;
  }
}

/** 冷启动只跑这条路径：基础数据并行 → 用 RT 缓存即时填充 → 后台异步补未命中 */
async function doFetchMonitors(jwt: string): Promise<FormattedMonitor[]> {
  // monitors + incidents 并行（Next Data Cache 命中时几乎零延迟，未命中也只等最慢的一个）
  const [monitorItems, allIncidents] = await Promise.all([
    fetchMonitorList(jwt),
    fetchAllIncidents(jwt),
  ]);

  const now = Math.floor(Date.now() / 1000);

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

  // 用 RT 缓存做即时填充（不发请求）
  hydrateResponseTimesFromCache(monitors);

  cacheSet("monitors", monitors);

  // 缺失的 RT 后台异步拉，绝不阻塞首屏
  fillResponseTimesAsync(jwt, monitors);

  return monitors;
}

let bgRefreshRunning = false;
async function refreshInBackground(jwt: string): Promise<void> {
  if (bgRefreshRunning || inflightPromise) return;
  bgRefreshRunning = true;
  try {
    await doFetchMonitors(jwt);
  } catch (e) {
    console.warn("[uptime-robot] Background refresh failed:", e);
  } finally {
    bgRefreshRunning = false;
  }
}

// ============================================================
// 响应时间（独立缓存 + 完全异步）
// ============================================================

const RT_TTL = 120 * 60 * 1000;

interface CachedRT {
  responseTimes: { datetime: number; value: number }[];
  averageResponseTime: number;
}

/** 同步：从缓存填充，不发请求。供冷启动主路径调用。 */
function hydrateResponseTimesFromCache(monitors: FormattedMonitor[]): void {
  const rtEntry = cacheGet<Record<number, CachedRT>>("responseTimes");
  if (!isStale(rtEntry, RT_TTL) || !rtEntry) return;

  for (const mon of monitors) {
    const cached = rtEntry.data[mon.id];
    if (cached) {
      mon.responseTimes = cached.responseTimes;
      mon.averageResponseTime = cached.averageResponseTime;
    }
  }
}

let rtRefreshRunning = false;

/**
 * 后台拉取响应时间。串行 + 7s 间隔（≈8.5 req/min，FREE plan 10 req/min 内）。
 * 永远不要 await 这个函数——它是 fire-and-forget，下一次轮询自然会拿到新数据。
 */
async function fillResponseTimesAsync(
  jwt: string,
  monitors: FormattedMonitor[],
): Promise<void> {
  if (rtRefreshRunning) return;
  rtRefreshRunning = true;

  try {
    const rtEntry = cacheGet<Record<number, CachedRT>>("responseTimes");
    const isCacheFresh = isFresh(rtEntry, RT_TTL);

    const rtCache: Record<number, CachedRT> =
      isStale(rtEntry, RT_TTL) && rtEntry ? { ...rtEntry.data } : {};

    // 全部命中且新鲜 → 不发请求
    const missing = monitors.filter((m) => !rtCache[m.id]);
    if (missing.length === 0 && isCacheFresh) return;

    // 全部命中但已过 FRESH → 后台轮换更新（每次只拉一个最旧的，避免堆积）
    const targets = missing.length > 0 ? missing : monitors.slice(0, 1);

    for (const mon of targets) {
      try {
        const rt = await fetchOneResponseTime(jwt, mon.id);
        const tsData = rt.time_series || [];
        const data: CachedRT = {
          responseTimes: tsData.map((ts, idx) => ({
            datetime: ts.datetime
              ? isoToUnix(ts.datetime)
              : Math.floor(Date.now() / 1000) - (tsData.length - 1 - idx) * 300,
            value: toNum(ts.value),
          })),
          averageResponseTime: Math.round(rt.summary.avg),
        };
        rtCache[mon.id] = data;
        // 同时更新当前 monitors 数组（同一对象被 cacheSet 引用，下次 FRESH 命中时已带 RT）
        mon.responseTimes = data.responseTimes;
        mon.averageResponseTime = data.averageResponseTime;
      } catch (e) {
        console.warn(
          `[uptime-robot] RT fetch failed for ${mon.name}:`,
          e instanceof Error ? e.message : e,
        );
      }

      await delay(RT_INTERVAL_MS);
    }

    cacheSet("responseTimes", rtCache);
  } finally {
    rtRefreshRunning = false;
  }
}

// ============================================================
// 工具函数
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
