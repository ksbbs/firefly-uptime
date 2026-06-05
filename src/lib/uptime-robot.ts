import type {
  FormattedMonitor,
  Incident,
  OverallStatus,
  MonitorLog,
  MonitorStatus,
  UptimeRatios,
} from "./types";
import { LOG_TYPE } from "./types";
import { fetchMonitorsV3 } from "./uptime-robot-v3";

// v2 API raw response types (only used in v2 fallback)
interface V2MonitorLog {
  id: number;
  type: number;
  datetime: number;
  duration: number;
  reason?: { code: string; detail: string };
}

interface V2ResponseTime {
  datetime: number;
  value: number;
}

interface UptimeRobotMonitor {
  id: number;
  friendly_name: string;
  url: string;
  type: number;
  sub_type?: string;
  keyword_type?: string;
  keyword_value?: string;
  http_method?: number;
  port?: string;
  interval?: number;
  status: MonitorStatus;
  logs?: V2MonitorLog[];
  custom_uptime_ratio?: number;
  custom_uptime_ratios?: string;
  custom_uptime_ranges?: string;
  average_response_time?: number;
  response_times?: V2ResponseTime[];
  create_datetime?: number;
}

interface V2Error {
  type: string;
  message: string;
}

interface UptimeRobotResponse {
  stat: "ok" | "fail";
  monitors?: UptimeRobotMonitor[];
  total?: number;
  offset?: number;
  limit?: number;
  error?: V2Error;
}

// ============================================================
// v3 为主，v2 降级
// ============================================================

/**
 * 尝试用 v3 API 获取，如果 UPTIME_ROBOT_JWT 未配置则用 v2 API Key
 * 优先使用 v3 (JWT Bearer Token)
 */
export async function fetchMonitors(
  jwtOrKey: string,
  isV3 = false
): Promise<FormattedMonitor[]> {
  // v3: JWT Bearer Token
  if (isV3) {
    const result = await fetchMonitorsV3(jwtOrKey);
    return result.monitors;
  }

  // v2: API Key fallback
  return fetchMonitorsV2(jwtOrKey);
}

// ============================================================
// v2 API 客户端（降级方案）
// ============================================================

const API_BASE_V2 = "https://api.uptimerobot.com/v2";

function toNum(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

function parseUptimeRanges(ranges?: string): UptimeRatios {
  const parts = (ranges || "")
    .split("-")
    .filter(Boolean)
    .map((s) => toNum(s));
  return {
    ratio7d: parts[0] ?? 100,
    ratio30d: parts[1] ?? 100,
    ratio90d: parts[2] ?? 100,
  };
}

async function fetchMonitorsV2(apiKey: string): Promise<FormattedMonitor[]> {
  const response = await fetch(`${API_BASE_V2}/getMonitors`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
    },
    body: new URLSearchParams({
      api_key: apiKey,
      format: "json",
      logs: "1",
      log_types: "1-2",
      log_date_start: String(
        Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000)
      ),
      custom_uptime_ratios: "7-30-90",
      response_times: "1",
      response_times_limit: "24",
      all_time_uptime_ratio: "1",
    }),
    next: { revalidate: 30 },
  });

  if (!response.ok) {
    throw new Error(`Uptime Robot v2 API error: ${response.status}`);
  }

  const data: UptimeRobotResponse = await response.json();

  if (data.stat === "fail") {
    throw new Error(
      `Uptime Robot v2 API error: ${data.error?.message || "Unknown"}`
    );
  }

  return (data.monitors || []).map(formatV2Monitor);
}

function formatV2Monitor(monitor: UptimeRobotMonitor): FormattedMonitor {
  const statusLabels: Record<number, string> = {
    0: "Paused",
    1: "Pending",
    2: "Up",
    8: "Seems Down",
    9: "Down",
  };

  const allLogs = (monitor.logs || []).filter(
    (log: V2MonitorLog) => log.type === LOG_TYPE.DOWN || log.type === LOG_TYPE.UP
  ).map((log) => ({
    id: log.id,
    type: log.type,
    datetime: log.datetime,
    duration: log.duration,
    reason: log.reason,
  }));

  return {
    id: monitor.id,
    name: monitor.friendly_name,
    url: monitor.url,
    status: monitor.status,
    statusLabel: statusLabels[monitor.status] || "Unknown",
    monitorType: String(monitor.type),
    interval: monitor.interval ?? 300,
    uptimeRatios: parseUptimeRanges(monitor.custom_uptime_ratios),
    averageResponseTime: toNum(monitor.average_response_time),
    logs: allLogs,
    responseTimes: (monitor.response_times || []).map((rt) => ({
      datetime: rt.datetime,
      value: toNum(rt.value),
    })),
    downEvents: allLogs.filter((log) => log.type === LOG_TYPE.DOWN),
  };
}

// ============================================================
// 通用工具函数
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
