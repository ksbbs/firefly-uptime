"use client";

import { useEffect } from "react";
import type { FormattedMonitor } from "@/lib/types";
import { MONITOR_STATUS } from "@/lib/types";
import ResponseTimeChart from "./ResponseTimeChart";
import MiniHistoryBar from "./MiniHistoryBar";

interface MonitorDetailProps {
  monitor: FormattedMonitor;
  onClose: () => void;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (diffDays === 0)
    return `今天 ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  if (diffDays === 1)
    return `昨天 ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
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

export default function MonitorDetail({
  monitor,
  onClose,
}: MonitorDetailProps) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const isDown =
    monitor.status === MONITOR_STATUS.DOWN ||
    monitor.status === MONITOR_STATUS.SEEMS_DOWN;
  const isUp = monitor.status === MONITOR_STATUS.UP;

  const recentDowns = monitor.downEvents
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full sm:max-w-2xl sm:mx-4 max-h-[85vh] sm:max-h-[80vh] bg-bg-card border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden animate-slide-up shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-bg-card border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${
                isDown
                  ? "bg-down shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                  : isUp
                    ? "bg-up shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                    : "bg-paused"
              }`}
            />
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                {monitor.name}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 rounded-full text-xs font-medium border ${
                isDown
                  ? "bg-down/10 text-down border-down/20"
                  : isUp
                    ? "bg-up/10 text-up border-up/20"
                    : "bg-paused/10 text-paused border-paused/20"
              }`}
            >
              {isDown && <span className="animate-status-pulse mr-1">●</span>}
              {monitor.statusLabel}
            </span>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-border/50 transition-all"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-6">
          {/* Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-bg-primary/50 border border-border/50">
              <p className="text-text-muted text-xs mb-1">监控类型</p>
              <p className="text-text-primary text-sm font-semibold capitalize">
                {monitor.monitorType}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-bg-primary/50 border border-border/50">
              <p className="text-text-muted text-xs mb-1">检查间隔</p>
              <p className="text-text-primary text-sm font-semibold">
                每 {monitor.interval} 秒
              </p>
            </div>
            <div className="p-3 rounded-xl bg-bg-primary/50 border border-border/50">
              <p className="text-text-muted text-xs mb-1">宕机次数</p>
              <p
                className={`text-sm font-semibold ${
                  monitor.downEvents.length > 0 ? "text-down" : "text-up"
                }`}
              >
                {monitor.downEvents.length} 次
              </p>
            </div>
            <div className="p-3 rounded-xl bg-bg-primary/50 border border-border/50">
              <p className="text-text-muted text-xs mb-1">平均响应</p>
              <p className="text-text-primary text-sm font-semibold">
                {monitor.averageResponseTime > 0
                  ? `${monitor.averageResponseTime}ms`
                  : "-"}
              </p>
            </div>
          </div>

          {/* Uptime Breakdown */}
          <div>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              Uptime 统计
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "过去 7 天", value: monitor.uptimeRatios.ratio7d },
                { label: "过去 30 天", value: monitor.uptimeRatios.ratio30d },
                { label: "过去 90 天", value: monitor.uptimeRatios.ratio90d },
              ].map((item) => (
                <div
                  key={item.label}
                  className="p-3 rounded-xl bg-bg-primary/50 border border-border/50 text-center"
                >
                  <div
                    className={`text-2xl font-bold tabular-nums ${
                      item.value >= 100
                        ? "text-up"
                        : item.value >= 99
                          ? "text-paused"
                          : "text-down"
                    }`}
                  >
                    {item.value.toFixed(2)}%
                  </div>
                  <p className="text-text-muted text-xs mt-1">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 7-Day History Bar */}
          <div>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              最近 7 天趋势
            </h3>
            <div className="p-4 rounded-xl bg-bg-primary/50 border border-border/50">
              <MiniHistoryBar logs={monitor.logs} days={7} />
              <div className="flex justify-between text-[10px] text-text-muted mt-1.5">
                <span>7 天前</span>
                <span>今天</span>
              </div>
            </div>
          </div>

          {/* Response Time Chart */}
          <div>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              响应时间趋势
            </h3>
            <div className="p-4 rounded-xl bg-bg-primary/50 border border-border/50">
              <ResponseTimeChart data={monitor.responseTimes} />
            </div>
          </div>

          {/* Recent Down Events */}
          {recentDowns.length > 0 && (
            <div>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                最近宕机事件
              </h3>
              <div className="space-y-2">
                {recentDowns.map((log, i) => (
                  <div
                    key={`${log.id}-${i}`}
                    className="flex items-center justify-between p-3 rounded-xl bg-down/5 border border-down/10"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-down" />
                      <div>
                        <p className="text-text-primary text-sm">
                          {formatTimestamp(log.datetime)}
                        </p>
                        {log.reason?.detail && (
                          <p className="text-text-muted text-xs">
                            {log.reason.detail}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-down text-xs font-medium">
                      持续 {formatDuration(log.duration)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No incidents */}
          {recentDowns.length === 0 && (
            <div className="text-center py-6 text-text-muted text-sm">
              过去 90 天无宕机事件 🎉
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
