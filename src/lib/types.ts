// ============================================================
// 内部统一类型（UI 层使用，不直接依赖 API 版本）
// ============================================================

export type MonitorStatus = 0 | 1 | 2 | 8 | 9;

export const MONITOR_STATUS = {
  PAUSED: 0,
  NOT_CHECKED_YET: 1,
  UP: 2,
  SEEMS_DOWN: 8,
  DOWN: 9,
} as const;

export function getMonitorStatusLabel(status: MonitorStatus): string {
  switch (status) {
    case MONITOR_STATUS.PAUSED:
      return "Paused";
    case MONITOR_STATUS.NOT_CHECKED_YET:
      return "Pending";
    case MONITOR_STATUS.UP:
      return "Up";
    case MONITOR_STATUS.SEEMS_DOWN:
      return "Seems Down";
    case MONITOR_STATUS.DOWN:
      return "Down";
    default:
      return "Unknown";
  }
}

export function getMonitorStatusColor(status: MonitorStatus): string {
  switch (status) {
    case MONITOR_STATUS.UP:
      return "var(--color-up)";
    case MONITOR_STATUS.DOWN:
    case MONITOR_STATUS.SEEMS_DOWN:
      return "var(--color-down)";
    case MONITOR_STATUS.PAUSED:
      return "var(--color-paused)";
    default:
      return "var(--color-text-muted)";
  }
}

// ============================================================
// Log types
// ============================================================

export interface MonitorLog {
  id: number;
  type: number; // 1=DOWN, 2=UP
  datetime: number; // unix timestamp
  duration: number; // seconds
  reason?: { code: string; detail: string };
}

export const LOG_TYPE = {
  DOWN: 1,
  UP: 2,
} as const;

// ============================================================
// Uptime ratios
// ============================================================

export interface UptimeRatios {
  ratio7d: number;
  ratio30d: number;
  ratio90d: number;
}

// ============================================================
// v3 API raw response types
// ============================================================

export type V3LogType = "down" | "up";
export type V3MonitorStatus = "up" | "down" | "paused" | "seems_down" | "not_checked_yet";
export type V3MonitorType = "http" | "keyword" | "ping" | "port" | "heartbeat" | "dns";

export interface V3MonitorLog {
  id: number;
  type: V3LogType;
  datetime: string; // ISO 8601
  duration: number;
  reason?: { code: string; detail: string };
}

export interface V3ResponseTime {
  datetime: string; // ISO 8601
  value: number;
}

export interface V3Monitor {
  id: number;
  friendly_name: string;
  url: string;
  type: V3MonitorType;
  sub_type?: string | null;
  keyword_type?: string | null;
  keyword_value?: string | null;
  http_method?: number | null;
  http_username?: string | null;
  http_password?: string | null;
  port?: number | null;
  interval: number;
  status: V3MonitorStatus;
  create_datetime: string;
  logs?: V3MonitorLog[];
  custom_uptime_ratio?: number;
  custom_uptime_ratios?: string;
  custom_uptime_ranges?: string;
  average_response_time?: number;
  response_times?: V3ResponseTime[];
}

export interface V3MonitorResponse {
  data: V3Monitor[];
  pagination: {
    cursor?: string;
    has_more: boolean;
  };
}

export function v3StatusToInternal(status: V3MonitorStatus): MonitorStatus {
  switch (status) {
    case "up": return MONITOR_STATUS.UP;
    case "down": return MONITOR_STATUS.DOWN;
    case "seems_down": return MONITOR_STATUS.SEEMS_DOWN;
    case "paused": return MONITOR_STATUS.PAUSED;
    case "not_checked_yet": return MONITOR_STATUS.NOT_CHECKED_YET;
    default: return MONITOR_STATUS.NOT_CHECKED_YET;
  }
}

export function v3LogTypeToInternal(type: V3LogType): number {
  return type === "down" ? LOG_TYPE.DOWN : LOG_TYPE.UP;
}

// ============================================================
// 统一的 UI 层类型
// ============================================================

export interface FormattedMonitor {
  id: number;
  name: string;
  url: string;
  status: MonitorStatus;
  statusLabel: string;
  monitorType: string;
  interval: number;
  uptimeRatios: UptimeRatios;
  averageResponseTime: number;
  logs: MonitorLog[];
  responseTimes: { datetime: number; value: number }[];
  /** DOWN events */
  downEvents: MonitorLog[];
}

export interface Incident {
  id: number;
  monitorId: number;
  monitorName: string;
  monitorUrl: string;
  datetime: number;
  duration: number;
  isOngoing: boolean;
  reason?: string;
}

export interface OverallStatus {
  status: "operational" | "degraded" | "down";
  label: string;
}
