"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { FormattedMonitor, Incident } from "@/lib/types";
import { MONITOR_STATUS } from "@/lib/types";
import StatusHeader from "@/components/StatusHeader";
import SearchFilter from "@/components/SearchFilter";
import MonitorCard from "@/components/MonitorCard";
import MonitorDetail from "@/components/MonitorDetail";
import IncidentTimeline from "@/components/IncidentTimeline";

interface StatusPageData {
  monitors: FormattedMonitor[];
  overall: { status: "operational" | "degraded" | "down"; label: string };
  incidents: Incident[];
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10 space-y-6">
        {/* Header skeleton */}
        <div className="rounded-2xl bg-bg-card border border-border p-6 sm:p-8 animate-pulse">
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-full bg-border" />
            <div className="flex-1">
              <div className="h-6 w-40 bg-border rounded mb-2" />
              <div className="h-4 w-24 bg-border rounded" />
            </div>
            <div className="h-8 w-32 bg-border rounded-full" />
          </div>
        </div>

        {/* Search skeleton */}
        <div className="h-11 rounded-xl bg-bg-card border border-border animate-pulse" />

        {/* Cards grid skeleton */}
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="rounded-2xl bg-bg-card border border-border p-5 animate-pulse"
            >
              <div className="flex justify-between mb-4">
                <div className="h-5 w-28 bg-border rounded" />
                <div className="h-6 w-16 bg-border rounded-full" />
              </div>
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="h-10 bg-border rounded" />
                <div className="h-10 bg-border rounded" />
                <div className="h-10 bg-border rounded" />
              </div>
              <div className="h-8 bg-border rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-center p-8 max-w-md">
        <div className="w-16 h-16 rounded-full bg-down/10 flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-8 h-8 text-down"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          无法获取状态数据
        </h2>
        <p className="text-text-secondary text-sm mb-6">
          请确保已配置 Uptime Robot API Key，或稍后重试
        </p>
        <button
          onClick={onRetry}
          className="px-6 py-2.5 rounded-xl bg-accent/15 text-accent border border-accent/30 text-sm font-medium hover:bg-accent/25 transition-all"
        >
          重新加载
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<StatusPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "up" | "down" | "paused">("all");
  const [selectedMonitor, setSelectedMonitor] = useState<FormattedMonitor | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/monitors");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredMonitors = useMemo(() => {
    if (!data) return [];
    let list = data.monitors;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.url.toLowerCase().includes(q)
      );
    }

    switch (filter) {
      case "up":
        list = list.filter((m) => m.status === MONITOR_STATUS.UP);
        break;
      case "down":
        list = list.filter(
          (m) =>
            m.status === MONITOR_STATUS.DOWN ||
            m.status === MONITOR_STATUS.SEEMS_DOWN
        );
        break;
      case "paused":
        list = list.filter((m) => m.status === MONITOR_STATUS.PAUSED);
        break;
    }

    return list;
  }, [data, search, filter]);

  if (loading && !data) return <LoadingSkeleton />;
  if (error && !data) return <ErrorState onRetry={fetchData} />;
  if (!data) return <LoadingSkeleton />;

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10 space-y-5">
        {/* Header */}
        <StatusHeader
          status={data.overall.status}
          label={data.overall.label}
          totalMonitors={data.monitors.length}
        />

        {/* Last updated */}
        <div className="flex items-center justify-between animate-fade-in stagger-1">
          <p className="text-text-muted text-xs">
            {data.monitors.length > 0
              ? `已监控 ${data.monitors.length} 个服务 · 每 30 秒自动刷新`
              : "暂无监控项"}
          </p>
          <button
            onClick={fetchData}
            className="text-text-muted hover:text-text-secondary text-xs transition-colors flex items-center gap-1"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            刷新
          </button>
        </div>

        {/* Search & Filter */}
        <SearchFilter
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
          totalCount={data.monitors.length}
          filteredCount={filteredMonitors.length}
        />

        {/* Monitor Grid */}
        {filteredMonitors.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {filteredMonitors.map((monitor, index) => (
              <div
                key={monitor.id}
                className={`animate-slide-up stagger-${Math.min(index + 1, 8)}`}
              >
                <MonitorCard
                  monitor={monitor}
                  onClick={() => setSelectedMonitor(monitor)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-bg-card border border-border p-10 text-center animate-fade-in">
            <p className="text-text-muted">
              {search || filter !== "all"
                ? "没有匹配的监控项"
                : "暂无监控数据，请检查 Uptime Robot 配置"}
            </p>
          </div>
        )}

        {/* Incident Timeline */}
        <IncidentTimeline incidents={data.incidents} />
      </div>

      {/* Monitor Detail Modal */}
      {selectedMonitor && (
        <MonitorDetail
          monitor={selectedMonitor}
          onClose={() => setSelectedMonitor(null)}
        />
      )}
    </div>
  );
}
