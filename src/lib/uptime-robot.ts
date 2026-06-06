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

/** 并行请求的最大并发数，避免触发 UptimeRobot rate limit (10 req/s) */
const MAX_CONCURRENCY = 8;

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

// ============================================================
// 并发控制
// ============================================================

/**
 * 带并发上限的并行执行。
 * 单个 task 失败时对应位置填 null，不阻塞其他 task。
 */
async function parallelWithLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<(T | null)[]> {
  const results: (T | null)[] = new Array(tasks.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const i = cursor++;
      try {
        results[i] = await tasks[i]();
      } catch {
        // 单个失败 → null，不中断整体
      }
    }
  }

  const workers = Math.min(limit, tasks.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

// ============================================================
// v3 API 调用
// ============================================================

/** Step 1: 获取全量 monitor 列表 */
async function fetchMonitorList(jwt: string): Promise<V3MonitorListItem[]> {
  const res = await fetch(`${API_BASE}/monitors?limit=200`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Uptime Robot v3 API error (monitors): ${res.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
    );
  }

  const json = await res.json();
  const monitors: V3MonitorListItem[] = json.data ?? [];

  // 如果超过 200 个 monitor，记录警告（当前 limit=200 是最大值）
  if (json.nextLink) {
    console.warn(
      `[uptime-robot] Monitor count exceeds 200 (pagination detected). ` +
        `Only the first 200 monitors are loaded. Consider filtering by groupId.`,
    );
  }

  return monitors;
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
  const res = await fetch(
    `${API_BASE}/monitors/${monitorId}/stats/uptime?${params}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  if (!res.ok) {
    throw new Error(`Uptime stats failed for monitor ${monitorId}: ${res.status}`);
  }
  return res.json();
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
  const res = await fetch(
    `${API_BASE}/monitors/${monitorId}/stats/response-time?${params}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  if (!res.ok) {
    throw new Error(
      `Response time stats failed for monitor ${monitorId}: ${res.status}`,
    );
  }
  return res.json();
}

/** Step 3: 获取过去 90 天的宕机事件 */
async function fetchIncidents(jwt: string): Promise<V3IncidentItem[]> {
  const params = new URLSearchParams({
    started_after: daysAgoISO(90),
    limit: "50",
  });
  const res = await fetch(`${API_BASE}/incidents?${params}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    throw new Error(`Incidents fetch failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data ?? [];
}

// ============================================================
// 主入口
// ============================================================

/**
 * 使用 v3 REST API 获取全部 monitor 及其详细 stats。
 *
 * 数据流：
 *   1. GET /monitors?limit=200      → 基本列表
 *   2. 并行 GET /monitors/{id}/stats/uptime     (7d/30d/90d × N)
 *            GET /monitors/{id}/stats/response-time  (1d × N)
 *   3. GET /incidents?started_after=90d → 宕机事件
 *
 * 所有 stats 调用在服务端并行执行，通过 ISR 30s 缓存降低 API 压力。
 * 单个 monitor 的 stats 失败不影响其他 monitor（对应字段填默认值）。
 */
export async function fetchMonitors(
  jwt: string,
): Promise<FormattedMonitor[]> {
  // ── Step 1: 获取 monitor 列表 ──────────────────────────────
  const monitorItems = await fetchMonitorList(jwt);

  if (monitorItems.length === 0) return [];

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

  // ── Step 2: 并行获取每个 monitor 的 stats ──────────────────
  const statsTasks: (() => Promise<void>)[] = [];

  for (const mon of monitors) {
    statsTasks.push(async () => {
      // 4 个独立 API 调用：3 个时间范围 uptime + 1 个响应时间
      const [r7, r30, r90, rt] = await Promise.all([
        fetchUptimeStats(jwt, mon.id, 7).catch(() => null),
        fetchUptimeStats(jwt, mon.id, 30).catch(() => null),
        fetchUptimeStats(jwt, mon.id, 90).catch(() => null),
        fetchResponseTimeStats(jwt, mon.id).catch(() => null),
      ]);

      mon.uptimeRatios = {
        ratio7d: r7?.uptime ?? 100,
        ratio30d: r30?.uptime ?? 100,
        ratio90d: r90?.uptime ?? 100,
      };

      if (rt) {
        mon.averageResponseTime = Math.round(rt.summary.avg);
        mon.responseTimes = (rt.time_series || []).map((ts) => ({
          datetime: isoToUnix(ts.datetime),
          value: toNum(ts.value),
        }));
      }
    });
  }

  await parallelWithLimit(statsTasks, MAX_CONCURRENCY);

  // ── Step 3: 获取 incidents（宕机事件） ─────────────────────
  try {
    const incidents = await fetchIncidents(jwt);

    for (const inc of incidents) {
      const mon = monitors.find((m) => m.id === inc.monitor.id);
      if (!mon) continue;

      // 仅纳入 DOWNTIME 类型的事件
      if (inc.type !== "DOWNTIME") continue;

      const log: MonitorLog = {
        id: parseInt(inc.id, 10) || 0,
        type: LOG_TYPE.DOWN,
        datetime: isoToUnix(inc.startedAt),
        duration: inc.duration ?? 0, // null → 0 表示进行中
        reason: inc.reason
          ? { code: "DOWNTIME", detail: inc.reason }
          : undefined,
      };

      mon.logs.push(log);
      mon.downEvents.push(log);
    }
  } catch (err) {
    console.warn("[uptime-robot] Failed to fetch incidents, continuing without:", err);
  }

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
        // 持续时间为 0 且在 24 小时内视为进行中
        isOngoing: log.duration === 0 && now - log.datetime < 86400,
        reason: log.reason?.detail,
      });
    }
  }

  incidents.sort((a, b) => b.datetime - a.datetime);
  return incidents.slice(0, 50);
}
