import type {
  FormattedMonitor,
  MonitorLog,
  UptimeRatios,
  V3MonitorResponse,
  V3Monitor,
  V3MonitorLog,
} from "./types";
import { v3StatusToInternal, v3LogTypeToInternal } from "./types";

const API_BASE = "https://api.uptimerobot.com/v3";

function toNum(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

/** Convert ISO 8601 string to unix timestamp */
function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** Parse "100.0-99.98-99.95" into 7d/30d/90d ratios */
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

/** Normalize a v3 log entry to internal format */
function formatLog(log: V3MonitorLog): MonitorLog {
  return {
    id: log.id,
    type: v3LogTypeToInternal(log.type),
    datetime: isoToUnix(log.datetime),
    duration: log.duration,
    reason: log.reason,
  };
}

/** Normalize a v3 monitor to internal FormattedMonitor */
function formatMonitor(monitor: V3Monitor): FormattedMonitor {
  const allLogs = (monitor.logs || []).map(formatLog);
  const status = v3StatusToInternal(monitor.status);

  const responseTimes = (monitor.response_times || []).map((rt) => ({
    datetime: isoToUnix(rt.datetime),
    value: toNum(rt.value),
  }));

  return {
    id: monitor.id,
    name: monitor.friendly_name,
    url: monitor.url,
    status,
    statusLabel: monitor.status === "up" ? "Up" : monitor.status === "down" ? "Down" : "Paused",
    monitorType: monitor.type,
    interval: monitor.interval,
    uptimeRatios: parseUptimeRanges(monitor.custom_uptime_ratios),
    averageResponseTime: toNum(monitor.average_response_time),
    logs: allLogs,
    responseTimes,
    downEvents: allLogs.filter((log) => log.type === 1),
  };
}

/**
 * Fetch monitors using v3 REST API
 * Auth: `Authorization: Bearer <jwt>`
 * Endpoint: GET /v3/monitors
 */
export async function fetchMonitorsV3(jwt: string): Promise<{
  monitors: FormattedMonitor[];
}> {
  const params = new URLSearchParams({
    logs: "1",
    log_types: "down,up",
    custom_uptime_ratios: "7-30-90",
    response_times: "1",
    response_times_limit: "24",
    all_time_uptime_ratio: "1",
  });

  const response = await fetch(`${API_BASE}/monitors?${params}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    next: { revalidate: 30 },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Uptime Robot v3 API error: ${response.status}${body ? ` - ${body}` : ""}`
    );
  }

  const data: V3MonitorResponse = await response.json();
  const monitors = (data.data || []).map(formatMonitor);

  return { monitors };
}
