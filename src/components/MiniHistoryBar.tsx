"use client";

import { MonitorLog, LOG_TYPE } from "@/lib/types";

interface MiniHistoryBarProps {
  /** DOWN events (type === 1) */
  logs: MonitorLog[];
  days?: number;
}

export default function MiniHistoryBar({
  logs,
  days = 7,
}: MiniHistoryBarProps) {
  const now = Math.floor(Date.now() / 1000);
  const startTime = now - days * 24 * 60 * 60;

  // Filter only DOWN events — that's what we visualize
  const downLogs = logs.filter((l) => l.type === LOG_TYPE.DOWN);

  // If no down events at all, all segments are pure green
  if (!downLogs || downLogs.length === 0) {
    return (
      <div className="flex gap-0.5 h-6 items-end">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: "100%",
              backgroundColor: "rgba(34, 197, 94, 0.15)",
            }}
          />
        ))}
      </div>
    );
  }

  const segments = 24;
  const interval = (days * 24 * 60 * 60) / segments;

  // Calculate for each segment: was there downtime? How severe?
  const segmentData = Array.from({ length: segments }, (_, i) => {
    const segStart = startTime + i * interval;
    const segEnd = segStart + interval;

    // Overlapping down events in this segment
    const overlapping = downLogs.filter((log) => {
      const logEnd = log.datetime + log.duration;
      return (
        (log.datetime >= segStart && log.datetime < segEnd) ||
        (logEnd >= segStart && logEnd < segEnd) ||
        (log.datetime <= segStart && logEnd >= segEnd) ||
        // Ongoing (duration = 0) that started before segEnd
        (log.duration === 0 && log.datetime < segEnd)
      );
    });

    const hasDown = overlapping.length > 0;

    // Calculate severity: total down duration in this segment / segment duration
    let severity = 0;
    for (const log of overlapping) {
      const overlapStart = Math.max(log.datetime, segStart);
      const overlapEnd =
        log.duration > 0
          ? Math.min(log.datetime + log.duration, segEnd)
          : segEnd; // Ongoing → spans to end of segment
      const overlapDuration = Math.max(0, overlapEnd - overlapStart);
      severity = Math.max(severity, overlapDuration / interval);
    }
    severity = Math.min(severity, 1);

    return { hasDown, severity };
  });

  return (
    <div className="flex gap-0.5 h-6 items-end">
      {segmentData.map((seg, i) => {
        const height = seg.hasDown
          ? 50 + Math.round(seg.severity * 50) // 50-100% height based on severity
          : 100; // Full height for green bars
        const opacity = seg.hasDown
          ? 0.3 + seg.severity * 0.7
          : 0.15;

        return (
          <div
            key={i}
            className="flex-1 rounded-sm transition-all duration-300 hover:opacity-100"
            style={{
              height: `${height}%`,
              backgroundColor: seg.hasDown
                ? `rgba(239, 68, 68, ${opacity})`
                : `rgba(34, 197, 94, ${opacity})`,
            }}
            title={
              seg.hasDown
                ? `宕机 (严重度: ${Math.round(seg.severity * 100)}%)`
                : "正常运行"
            }
          />
        );
      })}
    </div>
  );
}
