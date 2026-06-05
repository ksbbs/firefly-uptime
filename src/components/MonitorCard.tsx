"use client";

import { FormattedMonitor, MONITOR_STATUS } from "@/lib/types";
import MiniHistoryBar from "./MiniHistoryBar";

interface MonitorCardProps {
  monitor: FormattedMonitor;
}

function getStatusConfig(status: number) {
  switch (status) {
    case MONITOR_STATUS.UP:
      return {
        dot: "bg-up",
        glow: "shadow-[0_0_6px_rgba(34,197,94,0.3)]",
        bg: "bg-up/10",
        text: "text-up",
        border: "border-up/20",
      };
    case MONITOR_STATUS.DOWN:
    case MONITOR_STATUS.SEEMS_DOWN:
      return {
        dot: "bg-down",
        glow: "shadow-[0_0_6px_rgba(239,68,68,0.3)]",
        bg: "bg-down/10",
        text: "text-down",
        border: "border-down/20",
      };
    case MONITOR_STATUS.PAUSED:
      return {
        dot: "bg-paused",
        glow: "shadow-[0_0_6px_rgba(234,179,8,0.3)]",
        bg: "bg-paused/10",
        text: "text-paused",
        border: "border-paused/20",
      };
    default:
      return {
        dot: "bg-text-muted",
        glow: "",
        bg: "bg-text-muted/10",
        text: "text-text-muted",
        border: "border-border",
      };
  }
}

export default function MonitorCard({ monitor }: MonitorCardProps) {
  const config = getStatusConfig(monitor.status);
  const isDown = monitor.status === MONITOR_STATUS.DOWN || monitor.status === MONITOR_STATUS.SEEMS_DOWN;

  return (
    <div
      className={`rounded-2xl bg-bg-card border border-border hover:border-accent/20 p-5 transition-all duration-300 hover:shadow-lg hover:shadow-accent-glow hover:-translate-y-0.5 animate-fade-in`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <div
              className={`w-2.5 h-2.5 rounded-full ${config.dot} ${config.glow}`}
            />
            <h3 className="text-text-primary font-semibold truncate">
              {monitor.name}
            </h3>
          </div>
          {monitor.url && (
            <p className="text-text-muted text-xs truncate pl-5">
              {monitor.url.replace(/^https?:\/\//, "")}
            </p>
          )}
        </div>
        <div
          className={`px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text} ${config.border} border whitespace-nowrap`}
        >
          <span className="flex items-center gap-1">
            {isDown && (
              <span className="animate-status-pulse">●</span>
            )}
            {monitor.statusLabel}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="text-text-muted text-xs mb-0.5">响应时间</p>
          <p className="text-text-primary text-sm font-semibold tabular-nums">
            {monitor.averageResponseTime > 0
              ? `${monitor.averageResponseTime}ms`
              : "-"}
          </p>
        </div>
        <div>
          <p className="text-text-muted text-xs mb-0.5">7 天 uptime</p>
          <p
            className={`text-sm font-semibold tabular-nums ${
              monitor.uptimeRatio < 100 ? "text-down" : "text-up"
            }`}
          >
            {monitor.uptimeRatio.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-text-muted text-xs mb-0.5">状态</p>
          <div className="flex items-center gap-1.5">
            <span className="text-text-primary text-sm font-semibold">
              {monitor.logs.filter(l => l.type === 2).length > 0
                ? `${monitor.logs.filter(l => l.type === 2).length} 次`
                : "无事件"}
            </span>
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-text-muted text-xs">最近 7 天趋势</span>
          <span className="text-text-muted text-xs">
            {monitor.uptimeRatio.toFixed(2)}%
          </span>
        </div>
        <MiniHistoryBar logs={monitor.logs} days={7} />
      </div>
    </div>
  );
}
