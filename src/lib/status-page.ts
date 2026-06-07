import { fetchMonitors, getOverallStatus, getIncidents } from "./uptime-robot";
import type { FormattedMonitor, Incident, OverallStatus } from "./types";

export interface StatusPagePayload {
  monitors: FormattedMonitor[];
  overall: OverallStatus;
  incidents: Incident[];
}

/**
 * 服务端获取并 sanitize 状态页数据。SSR 首屏和 /api/monitors 共用。
 * url 字段被置空字符串以避免泄露被监控目标，但保留字段以兼容 FormattedMonitor 类型。
 * 抛错返回 null，让上游决定降级策略。
 */
export async function getStatusPageData(): Promise<StatusPagePayload | null> {
  const jwt = process.env.UPTIME_ROBOT_JWT;
  if (!jwt) return null;

  try {
    const monitors = await fetchMonitors(jwt);
    const overall = getOverallStatus(monitors);
    const incidents = getIncidents(monitors);

    const sanitizedMonitors: FormattedMonitor[] = monitors.map((m) => ({
      ...m,
      url: "",
    }));
    const sanitizedIncidents: Incident[] = incidents.map((inc) => ({
      ...inc,
      monitorUrl: "",
    }));

    return {
      monitors: sanitizedMonitors,
      overall,
      incidents: sanitizedIncidents,
    };
  } catch (e) {
    console.error("[status-page] fetch failed:", e);
    return null;
  }
}
