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

interface Props {
  initialData: StatusPageData;
}

export default function StatusPageClient({ initialData }: Props) {
  const [data, setData] = useState<StatusPageData>(initialData);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "up" | "down" | "paused">("all");
  const [selectedMonitor, setSelectedMonitor] = useState<FormattedMonitor | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/monitors");
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } catch {
      // 静默失败，保留旧数据
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredMonitors = useMemo(() => {
    let list = data.monitors;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }

    switch (filter) {
      case "up":
        list = list.filter((m) => m.status === MONITOR_STATUS.UP);
        break;
      case "down":
        list = list.filter(
          (m) =>
            m.status === MONITOR_STATUS.DOWN ||
            m.status === MONITOR_STATUS.SEEMS_DOWN,
        );
        break;
      case "paused":
        list = list.filter((m) => m.status === MONITOR_STATUS.PAUSED);
        break;
    }

    return list;
  }, [data, search, filter]);

  return (
    <div className="min-h-screen bg-bg-primary">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-10 space-y-5">
        <StatusHeader
          status={data.overall.status}
          label={data.overall.label}
          totalMonitors={data.monitors.length}
        />

        <div className="flex items-center justify-between animate-fade-in stagger-1">
          <p className="text-text-muted text-xs">
            {data.monitors.length > 0
              ? `已监控 ${data.monitors.length} 个服务 · 每 60 秒自动刷新`
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

        <SearchFilter
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
          totalCount={data.monitors.length}
          filteredCount={filteredMonitors.length}
        />

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

        <IncidentTimeline incidents={data.incidents} />
      </div>

      {selectedMonitor && (
        <MonitorDetail
          monitor={selectedMonitor}
          onClose={() => setSelectedMonitor(null)}
        />
      )}
    </div>
  );
}
