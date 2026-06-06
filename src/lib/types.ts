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
// v3 API 原始响应类型（与 UptimeRobot v3 OpenAPI 一致）
// ============================================================

/** GET /monitors 响应: data[] 中的单个 monitor（基本字段） */
export interface V3MonitorListItem {
  id: number;
  friendlyName: string;
  url: string;
  type: number;
  status: string; // "UP" | "DOWN" | "LOOKS_DOWN" | "PAUSED" | "STARTED"
  interval: number;
}

export interface V3MonitorsResponse {
  nextLink: string | null;
  data: V3MonitorListItem[];
}

/** GET /monitors/{id}/stats/uptime 响应 */
export interface V3UptimeStats {
  uptime: number; // 0-100
  total_downtime_seconds: number;
  incident_count: number;
  mtbf: number | null;
  from: string; // ISO 8601
  to: string; // ISO 8601
}

/** GET /monitors/{id}/stats/response-time 响应 */
export interface V3ResponseTimeStats {
  from: string;
  to: string;
  summary: {
    avg: number;
    min: number;
    max: number;
  };
  data_points: number;
  time_series?: Array<{
    datetime: string;
    value: number;
  }>;
}

/** GET /incidents 响应: data[] 中的单个 incident */
export interface V3IncidentItem {
  id: string;
  status: string; // "ONGOING" | "RESOLVED"
  type: string; // "DOWNTIME" | "SLOW_RESPONSE"
  reason: string;
  duration: number | null;
  startedAt: string; // ISO 8601
  resolvedAt: string | null;
  monitor: {
    id: number;
    friendlyName: string;
  };
}

export interface V3IncidentsResponse {
  nextLink: string | null;
  data: V3IncidentItem[];
}

// ============================================================
// v3 状态映射
// ============================================================

/** 将 v3 字符串状态映射为内部 numeric status */
export function v3StatusToInternal(status: string): MonitorStatus {
  switch (status) {
    case "UP":
      return MONITOR_STATUS.UP;
    case "DOWN":
      return MONITOR_STATUS.DOWN;
    case "LOOKS_DOWN":
      return MONITOR_STATUS.SEEMS_DOWN;
    case "PAUSED":
      return MONITOR_STATUS.PAUSED;
    case "STARTED":
      return MONITOR_STATUS.NOT_CHECKED_YET;
    default:
      return MONITOR_STATUS.NOT_CHECKED_YET;
  }
}

/** 将 v3 字符串状态映射为显示标签 */
export function v3StatusToLabel(status: string): string {
  switch (status) {
    case "UP":
      return "Up";
    case "DOWN":
      return "Down";
    case "LOOKS_DOWN":
      return "Seems Down";
    case "PAUSED":
      return "Paused";
    case "STARTED":
      return "Pending";
    default:
      return "Unknown";
  }
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
