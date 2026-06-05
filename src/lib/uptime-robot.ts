import type {
  UptimeRobotResponse,
  UptimeRobotMonitor,
  FormattedMonitor,
  Incident,
  MonitorLog,
  UptimeRatios,
} from "./types";
import { LOG_TYPE } from "./types";

const API_BASE = "https://api.uptimerobot.com/v2";

function toNum(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

/** Parse Uptime Robot custom_uptime_ranges like "99.98-97.50-95.00" into separate periods */
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

export async function fetchMonitors(
  apiKey: string
): Promise<FormattedMonitor[]> {
  const response = await fetch(`${API_BASE}/getMonitors`, {
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
    throw new Error(`Uptime Robot API error: ${response.status}`);
  }

  const data: UptimeRobotResponse = await response.json();

  if (data.stat === "fail") {
    throw new Error(
      `Uptime Robot API error: ${data.error?.message || "Unknown"}`
    );
  }

  return (data.monitors || []).map(formatMonitor);
}

function formatMonitor(monitor: UptimeRobotMonitor): FormattedMonitor {
  const statusLabels: Record<number, string> = {
    0: "Paused",
    1: "Pending",
    2: "Up",
    8: "Seems Down",
    9: "Down",
  };

  const allLogs = (monitor.logs || []).filter(
    (log: MonitorLog) => log.type === LOG_TYPE.DOWN || log.type === LOG_TYPE.UP
  );

  return {
    id: monitor.id,
    name: monitor.friendly_name,
    url: monitor.url,
    status: monitor.status,
    statusLabel: statusLabels[monitor.status] || "Unknown",
    uptimeRatios: parseUptimeRanges(monitor.custom_uptime_ranges),
    averageResponseTime: toNum(monitor.average_response_time),
    logs: allLogs,
    responseTimes: (monitor.response_times || []).map((rt) => ({
      datetime: rt.datetime,
      value: toNum(rt.value),
    })),
    /** DOWN events = incidents */
    downEvents: allLogs.filter((log: MonitorLog) => log.type === LOG_TYPE.DOWN),
  };
}

export function getOverallStatus(monitors: FormattedMonitor[]): {
  status: "operational" | "degraded" | "down";
  label: string;
} {
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
      });
    }
  }

  incidents.sort((a, b) => b.datetime - a.datetime);
  return incidents.slice(0, 50);
}
