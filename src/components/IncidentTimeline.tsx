"use client";

import type { Incident } from "@/lib/types";

interface IncidentTimelineProps {
  incidents: Incident[];
  limit?: number;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const eventDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const timeStr = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (eventDate.getTime() === today.getTime()) return `今天 ${timeStr}`;
  if (eventDate.getTime() === yesterday.getTime()) return `昨天 ${timeStr}`;
  return d.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  if (seconds === 0) return "进行中";
  const mins = Math.floor(seconds / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) {
    const remainMins = mins % 60;
    return `${hours}h ${remainMins}m`;
  }
  if (mins > 0) return `${mins} 分钟`;
  return `${seconds} 秒`;
}

export default function IncidentTimeline({
  incidents,
  limit = 20,
}: IncidentTimelineProps) {
  if (!incidents || incidents.length === 0) {
    return (
      <div className="rounded-2xl bg-bg-card border border-border p-6 sm:p-8 animate-fade-in">
        <h2 className="text-lg font-semibold text-text-primary mb-2">
          事件时间线
        </h2>
        <div className="flex flex-col items-center justify-center py-10 text-text-muted">
          <svg
            className="w-12 h-12 mb-3 opacity-40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <p className="text-sm">过去 30 天无宕机事件</p>
        </div>
      </div>
    );
  }

  const displayIncidents = incidents.slice(0, limit);
  const hasMore = incidents.length > limit;

  return (
    <div className="rounded-2xl bg-bg-card border border-border p-6 sm:p-8 animate-fade-in">
      <h2 className="text-lg font-semibold text-text-primary mb-1">
        事件时间线
      </h2>
      <p className="text-text-muted text-sm mb-6">
        过去 30 天的宕机事件记录
      </p>

      <div className="relative">
        <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border" />

        <div className="space-y-0">
          {displayIncidents.map((incident, index) => (
            <div
              key={`${incident.monitorId}-${incident.datetime}-${index}`}
              className="relative flex gap-4 pb-6 last:pb-0 animate-fade-in"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              {/* Dot */}
              <div className="relative z-10 flex-shrink-0 mt-1">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center ${
                    incident.isOngoing
                      ? "bg-down/20"
                      : "bg-text-muted/10"
                  }`}
                >
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      incident.isOngoing
                        ? "bg-down animate-status-pulse"
                        : "bg-text-muted"
                    }`}
                  />
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-text-primary text-sm font-medium">
                    {incident.monitorName}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      incident.isOngoing
                        ? "bg-down/10 text-down"
                        : "bg-up/10 text-up"
                    }`}
                  >
                    {incident.isOngoing ? "宕机中" : "已恢复"}
                  </span>
                </div>
                <p className="text-text-muted text-xs mt-1">
                  {formatTimestamp(incident.datetime)}
                  {incident.duration > 0 && (
                    <span className="ml-2">
                      持续 {formatDuration(incident.duration)}
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {hasMore && (
        <p className="text-center text-text-muted text-xs mt-4">
          及另外 {incidents.length - limit} 条事件记录
        </p>
      )}
    </div>
  );
}
