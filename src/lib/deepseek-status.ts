// ============================================================
// DeepSeek 状态页集成
// ============================================================
// 数据源: https://status.deepseek.com/feed.atom
//
// 注意: DeepSeek 的状态页是 Atlassian Statuspage + FlashDuty 包装层，
// 标准 /api/v2/*.json 端点全部 404，只能用 atom feed。
// feed 条目的 ID 形如 urn:flashduty:change:<long-digits>，
// status 字段是该 incident 的状态（"resolved" / "investigating" /
// "identified" / "monitoring"），不是当前服务的状态。
//
// 当前状态推断（启发式）:
//   - 7 天内无 entry                      → UP
//   - 最新 entry status = "resolved"      → UP
//   - 最新 entry status = 其他            → DOWN
//   - feed 拉取失败                       → NOT_CHECKED_YET（不显示 DOWN）

import type {
  FormattedMonitor,
  Incident,
  MonitorLog,
  MonitorStatus,
  UptimeRatios,
} from "./types";
import { LOG_TYPE, MONITOR_STATUS } from "./types";

const FEED_URL = "https://status.deepseek.com/feed.atom";
const STATUS_PAGE_URL = "https://status.deepseek.com";
const DEEPSEEK_MONITOR_ID = -1; // UptimeRobot ID 均为正数，用负数避免冲突
const CACHE_KEY = "deepseekFeed";
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟，与 UptimeRobot 一致
const RECENT_DAYS = 7; // 状态推断用的"最近"窗口

// ============================================================
// 服务端内存缓存（globalThis，warm instance 内复用）
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

// ============================================================
// 极简 atom 解析（手写，无外部依赖）
// ============================================================

interface ParsedEntry {
  id: string;
  title: string;
  updated: string;
  content: string;
  status: string; // "resolved" | "investigating" | "identified" | "monitoring" | 其他
}

function parseAtomFeed(xml: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  // 匹配每个 <entry>...</entry> 块（允许多行，[\s\S]*? 非贪婪）
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];

    const title = extractTag(block, "title");
    const id = extractTag(block, "id");
    const updated = extractTag(block, "updated");
    const content = extractTag(block, "content");
    const status = extractStatus(content);

    if (!title || !id || !updated) continue; // 缺关键字段则丢弃

    entries.push({ id, title, updated, content, status });
  }

  return entries;
}

function extractTag(block: string, tag: string): string {
  // 容忍 <tag>...</tag> 和 <tag attr="...">...</tag> 两种形式
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = re.exec(block);
  if (!m) return "";
  return decodeXmlEntities(m[1].trim());
}

function extractStatus(content: string): string {
  // feed 描述里有 "Status: resolved" 一行，提取冒号后的 token
  const m = /^Status:\s*(\w+)/im.exec(content);
  return m ? m[1].toLowerCase() : "";
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function isoToUnix(iso: string): number {
  const t = Date.parse(iso);
  if (isNaN(t)) return 0;
  return Math.floor(t / 1000);
}

// 从 FlashDuty 的 urn id 抽尾部数字作为稳定数字 id
function extractNumericId(id: string): number {
  const digits = id.match(/\d+/g);
  if (!digits) return 0;
  // 用全部数字拼接再 parseInt（ID 远小于 Number.MAX_SAFE_INTEGER）
  return parseInt(digits.join(""), 10) || 0;
}

// ============================================================
// 状态推断
// ============================================================

function inferStatus(entries: ParsedEntry[]): MonitorStatus {
  if (entries.length === 0) return MONITOR_STATUS.UP;

  const now = Math.floor(Date.now() / 1000);
  const recentThreshold = now - RECENT_DAYS * 24 * 3600;

  // 按 updated 倒序找最新一条
  const sorted = [...entries].sort(
    (a, b) => isoToUnix(b.updated) - isoToUnix(a.updated),
  );
  const latest = sorted[0];
  const latestTs = isoToUnix(latest.updated);

  // 最新 entry 不在最近 7 天 → 视为长期无事件，正常
  if (latestTs < recentThreshold) return MONITOR_STATUS.UP;

  // 在最近 7 天内，根据 status 字段推断
  if (latest.status === "resolved") return MONITOR_STATUS.UP;
  if (
    latest.status === "investigating" ||
    latest.status === "identified" ||
    latest.status === "monitoring"
  ) {
    return MONITOR_STATUS.DOWN;
  }

  // 状态未知但有新 entry，保守视为正常
  return MONITOR_STATUS.UP;
}

function statusLabel(status: MonitorStatus): string {
  switch (status) {
    case MONITOR_STATUS.UP:
      return "Up";
    case MONITOR_STATUS.DOWN:
      return "Down";
    case MONITOR_STATUS.SEEMS_DOWN:
      return "Seems Down";
    case MONITOR_STATUS.PAUSED:
      return "Paused";
    case MONITOR_STATUS.NOT_CHECKED_YET:
      return "状态未知";
    default:
      return "Unknown";
  }
}

// ============================================================
// Uptime 比率（粗略估算）
// ============================================================
// feed entry 是修复公告（resolved 事件），没有 startedAt。
// 把每条 entry 视为"持续 1 小时"的故障窗（粗略估计），
// 与 uptime-robot.ts 中的 calcUptimeFromIncidents 算法保持一致。

const FAULT_WINDOW_SECONDS = 60 * 60; // 1 小时

function calcUptimeFromEntries(entries: ParsedEntry[], days: number, now: number): number {
  const periodStart = now - days * 24 * 3600;
  const periodSeconds = days * 24 * 3600;

  let totalDowntime = 0;
  for (const entry of entries) {
    const ts = isoToUnix(entry.updated);
    if (ts === 0) continue;
    // 故障窗：[ts, ts + 1h)
    const start = ts;
    const end = ts + FAULT_WINDOW_SECONDS;
    const overlapStart = Math.max(start, periodStart);
    const overlapEnd = Math.min(end, now);
    if (overlapStart < overlapEnd) {
      totalDowntime += overlapEnd - overlapStart;
    }
  }

  return Math.max(0, ((periodSeconds - totalDowntime) / periodSeconds) * 100);
}

// ============================================================
// Feed → FormattedMonitor + Incident[] 转换
// ============================================================

function entriesToMonitor(entries: ParsedEntry[]): FormattedMonitor {
  const now = Math.floor(Date.now() / 1000);

  const status = inferStatus(entries);

  const downEvents: MonitorLog[] = entries.map((entry) => ({
    id: extractNumericId(entry.id),
    type: LOG_TYPE.DOWN,
    datetime: isoToUnix(entry.updated),
    duration: 0, // feed 无持续时长
    reason: { code: "DEEPSEEK_FEED", detail: entry.content },
  }));

  const uptimeRatios: UptimeRatios = {
    ratio7d: calcUptimeFromEntries(entries, 7, now),
    ratio30d: calcUptimeFromEntries(entries, 30, now),
    ratio90d: calcUptimeFromEntries(entries, 90, now),
  };

  return {
    id: DEEPSEEK_MONITOR_ID,
    name: "DeepSeek 状态页",
    url: STATUS_PAGE_URL,
    status,
    statusLabel: statusLabel(status),
    monitorType: "statuspage",
    interval: 0,
    uptimeRatios,
    averageResponseTime: 0,
    logs: downEvents,
    responseTimes: [],
    downEvents,
    source: "deepseek-feed",
  };
}

function entriesToIncidents(entries: ParsedEntry[]): Incident[] {
  const now = Math.floor(Date.now() / 1000);
  return entries.map((entry) => ({
    id: extractNumericId(entry.id),
    monitorId: DEEPSEEK_MONITOR_ID,
    monitorName: "DeepSeek 状态页",
    monitorUrl: STATUS_PAGE_URL,
    datetime: isoToUnix(entry.updated),
    duration: 0,
    // feed entry 都是历史事件，全部视为"已恢复"
    // 除非最新 entry 是 investigating/identified/monitoring
    isOngoing:
      entry.status !== "resolved" &&
      now - isoToUnix(entry.updated) < RECENT_DAYS * 24 * 3600,
    reason: entry.content,
    source: "deepseek-feed" as const,
  }));
}

// ============================================================
// 占位 monitor（feed 拉取失败时使用）
// ============================================================

function emptyMonitor(): FormattedMonitor {
  return {
    id: DEEPSEEK_MONITOR_ID,
    name: "DeepSeek 状态页",
    url: STATUS_PAGE_URL,
    status: MONITOR_STATUS.NOT_CHECKED_YET,
    statusLabel: statusLabel(MONITOR_STATUS.NOT_CHECKED_YET),
    monitorType: "statuspage",
    interval: 0,
    uptimeRatios: { ratio7d: 100, ratio30d: 100, ratio90d: 100 },
    averageResponseTime: 0,
    logs: [],
    responseTimes: [],
    downEvents: [],
    source: "deepseek-feed",
  };
}

// ============================================================
// 主入口
// ============================================================

export interface DeepSeekSnapshot {
  monitor: FormattedMonitor;
  incidents: Incident[];
}

/**
 * 获取 DeepSeek 状态页的合成 monitor + incidents。
 * 30 分钟 in-memory 缓存，feed 拉取失败时返回占位 monitor（不抛错）。
 */
export async function fetchDeepSeekSnapshot(): Promise<DeepSeekSnapshot> {
  const cached = cacheGet<DeepSeekSnapshot>(CACHE_KEY);

  if (isFresh(cached, CACHE_TTL) && cached) {
    return cached.data;
  }

  try {
    const res = await fetch(FEED_URL, {
      headers: { Accept: "application/atom+xml, application/xml, text/xml" },
      // 10s 超时——feed 端点应该秒回
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[deepseek-status] feed fetch ${res.status}`);
      return { monitor: emptyMonitor(), incidents: [] };
    }

    const xml = await res.text();
    const entries = parseAtomFeed(xml);

    if (entries.length === 0) {
      console.warn("[deepseek-status] feed parsed to 0 entries");
      return { monitor: emptyMonitor(), incidents: [] };
    }

    const snapshot: DeepSeekSnapshot = {
      monitor: entriesToMonitor(entries),
      incidents: entriesToIncidents(entries),
    };

    cacheSet(CACHE_KEY, snapshot);
    return snapshot;
  } catch (e) {
    console.warn("[deepseek-status] feed fetch failed:", e);
    return { monitor: emptyMonitor(), incidents: [] };
  }
}
