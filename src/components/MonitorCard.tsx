"use client";

import { FormattedMonitor, MONITOR_STATUS } from "@/lib/types";
import MiniHistoryBar from "./MiniHistoryBar";

interface MonitorCardProps {
  monitor: FormattedMonitor;
  onClick?: () => void;
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

function UptimeBadge({ value, label }: { value: number; label: string }) {
  const isPerfect = value >= 100;
  const isGood = value >= 99;
  return (
    <div className="text-center">
      <p
        className={`text-xs font-semibold tabular-nums ${
          isPerfect
            ? "text-up"
            : isGood
              ? "text-paused"
              : "text-down"
        }`}
      >
        {value.toFixed(2)}%
      </p>
      <p className="text-text-muted text-[10px]">{label}</p>
    </div>
  );
}

export default function MonitorCard({ monitor, onClick }: MonitorCardProps) {
  const config = getStatusConfig(monitor.status);
  const isDown =
    monitor.status === MONITOR_STATUS.DOWN ||
    monitor.status === MONITOR_STATUS.SEEMS_DOWN;
  const downCount = monitor.downEvents.length;

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl bg-bg-card border border-border hover:border-accent/20 p-5 transition-all duration-300 hover:shadow-lg hover:shadow-accent-glow hover:-translate-y-0.5 animate-fade-in cursor-pointer group"
    >
      {/* Header: Name + Status */}
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
        </div>
        <div
          className={`px-2.5 py-1 rounded-full text-xs font-medium ${config.bg} ${config.text} ${config.border} border whitespace-nowrap`}
        >
          <span className="flex items-center gap-1">
            {isDown && <span className="animate-status-pulse">●</span>}
            {monitor.statusLabel}
          </span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="text-text-muted text-xs mb-0.5">响应时间</p>
          <p className="text-text-primary text-sm font-semibold tabular-nums">
            {monitor.averageResponseTime > 0
              ? `${monitor.averageResponseTime}ms`
              : "-"}
          </p>
        </div>
        <div>
          <p className="text-text-muted text-xs mb-0.5">宕机次数</p>
          <p
            className={`text-sm font-semibold tabular-nums ${
              downCount > 0 ? "text-down" : "text-up"
            }`}
          >
            {downCount > 0 ? `${downCount} 次` : "0 次"}
          </p>
        </div>
        <div>
          <p className="text-text-muted text-xs mb-0.5">最后检查</p>
          <p className="text-text-primary text-sm font-semibold tabular-nums">
            {monitor.responseTimes.length > 0
              ? `${monitor.responseTimes[monitor.responseTimes.length - 1].value}ms`
              : "-"}
          </p>
        </div>
      </div>

      {/* Uptime Badges: 7d | 30d | 90d */}
      <div className="grid grid-cols-3 gap-2 mb-4 p-3 rounded-xl bg-bg-primary/50 border border-border/50">
        <UptimeBadge
          value={monitor.uptimeRatios.ratio7d}
          label="过去 7 天"
        />
        <UptimeBadge
          value={monitor.uptimeRatios.ratio30d}
          label="过去 30 天"
        />
        <UptimeBadge
          value={monitor.uptimeRatios.ratio90d}
          label="过去 90 天"
        />
      </div>

      {/* Mini History Bar */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-text-muted text-xs">最近 7 天趋势</span>
          <span
            className={`text-xs font-medium ${
              monitor.uptimeRatios.ratio7d >= 100
                ? "text-up"
                : monitor.uptimeRatios.ratio7d >= 99
                  ? "text-paused"
                  : "text-down"
            }`}
          >
            {monitor.uptimeRatios.ratio7d.toFixed(2)}%
          </span>
        </div>
        <MiniHistoryBar logs={monitor.logs} days={7} />
      </div>

      {/* Click hint */}
      <div className="mt-3 pt-2 border-t border-border/50 flex items-center justify-center gap-1 text-text-muted/40 group-hover:text-text-muted/60 text-[10px] transition-colors">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        点击查看详情
      </div>
    </button>
  );
}
