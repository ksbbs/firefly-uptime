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

export interface MonitorLog {
  id: number;
  type: number;
  datetime: number;
  duration: number;
}

export interface UptimeRobotMonitor {
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
  logs?: MonitorLog[];
  custom_uptime_ratio?: number;
  custom_uptime_ranges?: string;
  average_response_time?: number;
  response_times?: { datetime: number; value: number }[];
  create_datetime?: number;
}

export interface UptimeRobotResponse {
  stat: "ok" | "fail";
  monitors?: UptimeRobotMonitor[];
  total?: number;
  offset?: number;
  limit?: number;
  error?: {
    type: string;
    message: string;
  };
}

export interface FormattedMonitor {
  id: number;
  name: string;
  url: string;
  status: MonitorStatus;
  statusLabel: string;
  uptimeRatio: number;
  averageResponseTime: number;
  logs: MonitorLog[];
  responseTimes: { datetime: number; value: number }[];
  incidents: MonitorLog[];
}

export interface Incident {
  id: number;
  monitorId: number;
  monitorName: string;
  monitorUrl: string;
  datetime: number;
  duration: number;
  isOngoing: boolean;
}
