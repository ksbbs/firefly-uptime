"use client";

import { MonitorLog, MONITOR_STATUS } from "@/lib/types";

interface MiniHistoryBarProps {
  logs: MonitorLog[];
  days?: number;
}

export default function MiniHistoryBar({
  logs,
  days = 7,
}: MiniHistoryBarProps) {
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - days * 24 * 60 * 60;

  if (!logs || logs.length === 0) {
    return (
      <div className="flex gap-0.5 h-6 items-end">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm bg-up/20"
            style={{ height: "40%" }}
          />
        ))}
      </div>
    );
  }

  const segments = 24;
  const interval = (days * 24 * 60 * 60) / segments;
  const segmentLogs: { [key: number]: MonitorLog[] } = {};

  for (let i = 0; i < segments; i++) {
    const segStart = startTime + i * interval;
    const segEnd = segStart + interval;
    segmentLogs[i] = logs.filter((log) => {
      const logEnd = log.datetime + log.duration;
      return (
        (log.datetime >= segStart && log.datetime < segEnd) ||
        (logEnd >= segStart && logEnd < segEnd) ||
        (log.datetime <= segStart && logEnd >= segEnd)
      );
    });
  }

  const maxCount = Math.max(
    ...Object.values(segmentLogs).map((l) => l.length),
    1
  );

  return (
    <div className="flex gap-0.5 h-6 items-end">
      {Array.from({ length: segments }).map((_, i) => {
        const segment = segmentLogs[i] || [];
        const hasDown = segment.some(
          (l) =>
            l.type === 2
        );
        const height = Math.max(
          15,
          (segment.length / maxCount) * 100
        );
        const opacity = Math.min(0.15 + segment.length * 0.1, 0.9);

        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-all duration-300 hover:opacity-100"
            style={{
              height: `${height}%`,
              backgroundColor: hasDown
                ? `rgba(239, 68, 68, ${opacity})`
                : `rgba(34, 197, 94, ${opacity > 0.15 ? opacity : 0.15})`,
            }}
            title={
              segment.length > 0
                ? `${segment.length} 个事件`
                : "正常运行"
            }
          />
        );
      })}
    </div>
  );
}
