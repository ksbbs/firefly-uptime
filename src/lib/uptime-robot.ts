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
// 实际策略：每次请求最多发 1 个 RT 请求，30s 轮询 = 2 RT/min + 2 base/min = 4-6 req/min，远低于上限。

// ============================================================
// 全局速率门（FREE plan: 10 req/min 账户级，跨实例需要共享视角）
// ============================================================

/**
 * UptimeRobot v3 限流是账户级（不是 IP 级、也不是端点级）。
 * 多 serverless 实例并发会把 10/min 配额打爆。
 *
 * 策略：
 *   1. 进程内滑动窗口记录最近 60s 发出的请求时间戳（本地视角下界）
 *   2. 用响应里的 X-RateLimit-Remaining / X-RateLimit-Reset 校准（账户级真实值）
 *   3. 取两者更保守的，发请求前判断；不够就让非关键请求让步
 *   4. 429 优先用 Retry-After header（一般 5-10s），不再瞎用 20-40s 退避
 */

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;

let rateChainTail: Promise<unknown> = Promise.resolve();

interface RateState {
  /** 最近 60s 内本实例发出的请求时间戳（本地下界视角） */
  localStamps: number[];
  /** 来自上一次响应头的真实剩余值（账户级，跨实例共享视角） */
  serverRemaining: number | null;
  /** 上一次响应头记录时间，用于判断 serverRemaining 是否还新鲜 */
  serverStampedAt: number;
  /** Retry-After 给出的不可发请求的最早时间戳 */
  blockedUntil: number;
}

function getRateState(): RateState {
  const g = globalThis as Record<string, unknown>;
  if (!g.__rateState) {
    g.__rateState = {
      localStamps: [],
      serverRemaining: null,
      serverStampedAt: 0,
      blockedUntil: 0,
    } satisfies RateState;
  }
  return g.__rateState as RateState;
}

function pruneOldStamps(state: RateState, now: number): void {
  const cutoff = now - RATE_WINDOW_MS;
  state.localStamps = state.localStamps.filter((t) => t > cutoff);
}

/**
 * 估算当前可用配额下界（保守取本地 + 服务端两个视角中的较小者）。
 * 服务端视角超过 10s 不再可信（多实例可能已经又消费了），按本地估算。
 */
function estimateAvailable(): number {
  const state = getRateState();
  const now = Date.now();
  pruneOldStamps(state, now);

  const localUsed = state.localStamps.length;
  const localAvailable = Math.max(0, RATE_LIMIT - localUsed);

  let serverAvailable = Infinity;
  if (
    state.serverRemaining !== null &&
    now - state.serverStampedAt < 10_000
  ) {
    serverAvailable = state.serverRemaining;
  }

  return Math.min(localAvailable, serverAvailable);
}

function timeUntilAvailable(): number {
  const state = getRateState();
  const now = Date.now();

  if (state.blockedUntil > now) {
    return state.blockedUntil - now;
  }

  pruneOldStamps(state, now);
  if (estimateAvailable() > 0) return 0;

  if (state.localStamps.length === 0) return RATE_WINDOW_MS;
  const earliest = Math.min(...state.localStamps);
  return Math.max(0, earliest + RATE_WINDOW_MS - now);
}

interface RateAcquireOptions {
  critical: boolean;
  minRemaining?: number;
}

/**
 * 申请发起 1 次 v3 请求的资格。critical=true 时阻塞等待；critical=false 配额不足则返回 false。
 * 通过 rateChainTail 串行化避免并发请求一起穿透速率门。
 */
async function acquireRate(opts: RateAcquireOptions): Promise<boolean> {
  const ticket = rateChainTail.then(async () => {
    const state = getRateState();

    while (true) {
      const waitMs = timeUntilAvailable();
      if (waitMs === 0) break;

      if (!opts.critical) {
        return false;
      }
      await delay(Math.min(waitMs, 5_000));
    }

    const minRemaining = opts.minRemaining ?? 0;
    if (!opts.critical && estimateAvailable() <= minRemaining) {
      return false;
    }

    state.localStamps.push(Date.now());
    return true;
  });

  rateChainTail = ticket.then(
    () => undefined,
    () => undefined,
  );
  return ticket;
}

function ingestRateHeaders(res: Response): void {
  const state = getRateState();

  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining !== null) {
    const n = parseInt(remaining, 10);
    if (!isNaN(n)) {
      state.serverRemaining = n;
      state.serverStampedAt = Date.now();
    }
  }

  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    let waitSec = 10;
    if (retryAfter) {
      const n = parseInt(retryAfter, 10);
      if (!isNaN(n) && n > 0) waitSec = Math.min(n, 60);
    }
    state.blockedUntil = Date.now() + waitSec * 1000;
    state.serverRemaining = 0;
    state.serverStampedAt = Date.now();
  }
}

// ============================================================
// 工具函数 — 通用 helper
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
// v3 API 调用（速率门 + Retry-After + Next Data Cache）
// ============================================================

class RateLimitedError extends Error {
  constructor() {
    super("RATE_LIMIT_SKIPPED");
    this.name = "RateLimitedError";
  }
}

/**
 * v3 请求统一入口。
 *   - critical=true：base 数据，等到能发为止
 *   - critical=false：RT 等非关键数据，配额紧张直接抛 RateLimitedError，不发请求
 *
 * Next Data Cache（next.revalidate）依然在用：fetch 命中边缘缓存时不会进入这里的速率门。
 * 但生产环境上 stale 时仍需要打源站，速率门确保打源站的频率受控。
 */
async function v3Fetch<T>(
  url: string,
  jwt: string,
  revalidate: number,
  opts: { critical: boolean; minRemaining?: number } = { critical: true },
): Promise<T> {
  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const allowed = await acquireRate({
      critical: opts.critical,
      minRemaining: opts.minRemaining,
    });
    if (!allowed) {
      throw new RateLimitedError();
    }

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
      next: { revalidate },
    });

    ingestRateHeaders(res);

    if (res.ok) return res.json() as Promise<T>;

    if (res.status === 429 && attempt < maxRetries) {
      // ingestRateHeaders 已经把 blockedUntil 设好了，下一轮 acquireRate 会等 Retry-After
      const endpoint = url.split("?")[0].split("/v3")[1];
      console.warn(
        `[uptime-robot] 429 on ${endpoint}, will honor Retry-After`,
      );
      // 非关键请求 429 后直接放弃，不浪费下一次配额
      if (!opts.critical) throw new RateLimitedError();
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
    { critical: true },
  );
  return json.data ?? [];
}

async function fetchAllIncidents(jwt: string): Promise<V3IncidentItem[]> {
  const url = `${API_BASE}/incidents?started_after=${encodeURIComponent(daysAgoISO(90))}`;
  const json = await v3Fetch<{ nextLink: string | null; data: V3IncidentItem[] }>(
    url,
    jwt,
    BASE_REVALIDATE,
    { critical: true },
  );

  const all = [...(json.data ?? [])];

  let nextUrl = json.nextLink;
  let extraPages = 0;
  while (nextUrl && extraPages < 2) {
    // 分页本身不算关键 — 第一页通常已覆盖近期事件，配额紧张时跳过
    try {
      const page = await v3Fetch<{ nextLink: string | null; data: V3IncidentItem[] }>(
        nextUrl,
        jwt,
        BASE_REVALIDATE,
        { critical: false, minRemaining: 3 },
      );
      all.push(...(page.data ?? []));
      nextUrl = page.nextLink;
      extraPages++;
    } catch (e) {
      if (e instanceof RateLimitedError) break;
      throw e;
    }
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
  // RT 永远是非关键 — 配额不足时让位给 base
  return v3Fetch<V3ResponseTimeStats>(
    `${API_BASE}/monitors/${monitorId}/stats/response-time?${params}`,
    jwt,
    RT_REVALIDATE,
    { critical: false, minRemaining: 3 },
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
 *   FRESH (< 30 min)：直接返；RT 仅在配额充足时尝试补 1 个（非关键）
 *   STALE (30-90 min)：返旧数据 + 后台刷新；不补 RT（base 才是优先级）
 *   COLD (> 90 min / 冷启动)：阻塞拉取 base，配额允许时再补 1 个 RT
 *
 * 关键变化：RT 现在是"非关键"请求，配额不足时跳过，让位给 base 数据。
 */
export async function fetchMonitors(
  jwt: string,
): Promise<FormattedMonitor[]> {
  const entry = cacheGet<FormattedMonitor[]>("monitors");

  if (isFresh(entry, MONITORS_TTL) && entry) {
    await fetchOneMissingRT(jwt, entry.data);
    cacheSet("monitors", entry.data);
    return entry.data;
  }

  if (isStale(entry, MONITORS_TTL) && entry) {
    refreshInBackground(jwt);
    // STALE：base 都过期了，不再为 RT 抢配额
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

/** 冷启动主路径：基础数据并行 → 用 RT 缓存即时填充 → 阻塞补 1 个最缺的 RT */
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

  // 阻塞拉 1 个最缺/最旧的 RT，确保数据真的能进缓存
  // （Vercel serverless 函数返回后会冻结，fire-and-forget 不可靠）
  await fetchOneMissingRT(jwt, monitors);

  cacheSet("monitors", monitors);

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
// 响应时间（独立缓存 + 阻塞补一个最旧的）
// ============================================================

const RT_TTL = 120 * 60 * 1000;
const RT_FRESH_TTL = 30 * 60 * 1000; // RT 数据 30 分钟内视为新鲜

interface CachedRT {
  responseTimes: { datetime: number; value: number }[];
  averageResponseTime: number;
  fetchedAt: number; // 用于"最旧优先"轮换刷新
}

/** 同步：从缓存填充，不发请求。供主路径调用。 */
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

/**
 * 阻塞拉取 1 个 RT 数据（最多）。优先级：
 *   1. 没有 RT 缓存的 monitor（首次填充）
 *   2. 缓存最旧的 monitor（轮换刷新）
 *
 * 仅在以下场景跳过：
 *   - 全部 monitor 都有 RT 且都在 RT_FRESH_TTL 内
 *   - rtRefreshRunning 锁占用（同一 warm instance 内已有 RT 请求在飞）
 *
 * 失败容忍：单个 RT 失败时不抛错，只 warn，让基础数据正常返回。
 */
async function fetchOneMissingRT(
  jwt: string,
  monitors: FormattedMonitor[],
): Promise<void> {
  if (monitors.length === 0) return;
  if (rtRefreshRunning) return;

  const rtEntry = cacheGet<Record<number, CachedRT>>("responseTimes");
  const rtCache: Record<number, CachedRT> =
    isStale(rtEntry, RT_TTL) && rtEntry ? { ...rtEntry.data } : {};

  // 1. 找无缓存的 monitor
  const missing = monitors.find((m) => !rtCache[m.id]);
  let target: FormattedMonitor | undefined = missing;

  // 2. 没有缺失 → 找缓存最旧的（且已过 FRESH 阈值）
  if (!target) {
    let oldestAge = -1;
    const now = Date.now();
    for (const mon of monitors) {
      const cached = rtCache[mon.id];
      if (!cached) continue;
      const age = now - cached.fetchedAt;
      if (age > RT_FRESH_TTL && age > oldestAge) {
        oldestAge = age;
        target = mon;
      }
    }
  }

  // 全部 fresh → 不发请求
  if (!target) return;

  rtRefreshRunning = true;
  try {
    const rt = await fetchOneResponseTime(jwt, target.id);
    const tsData = rt.time_series || [];
    const data: CachedRT = {
      responseTimes: tsData.map((ts, idx) => ({
        datetime: ts.datetime
          ? isoToUnix(ts.datetime)
          : Math.floor(Date.now() / 1000) - (tsData.length - 1 - idx) * 300,
        value: toNum(ts.value),
      })),
      averageResponseTime: Math.round(rt.summary.avg),
      fetchedAt: Date.now(),
    };
    rtCache[target.id] = data;

    // 同步更新当前 monitors 数组（同对象会被 cacheSet 引用）
    target.responseTimes = data.responseTimes;
    target.averageResponseTime = data.averageResponseTime;

    cacheSet("responseTimes", rtCache);
  } catch (e) {
    if (e instanceof RateLimitedError) {
      // 配额紧张，让位给 base — 静默跳过，下次请求会再尝试
      return;
    }
    console.warn(
      `[uptime-robot] RT fetch failed for ${target.name}:`,
      e instanceof Error ? e.message : e,
    );
  } finally {
    rtRefreshRunning = false;
  }
}

let rtRefreshRunning = false;

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
