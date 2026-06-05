"use client";

interface StatusHeaderProps {
  status: "operational" | "degraded" | "down";
  label: string;
  totalMonitors: number;
}

const statusConfig = {
  operational: {
    dotBg: "bg-up",
    dotGlow: "shadow-[0_0_12px_rgba(34,197,94,0.5)]",
    bg: "bg-up/10",
    border: "border-up/20",
  },
  degraded: {
    dotBg: "bg-paused",
    dotGlow: "shadow-[0_0_12px_rgba(234,179,8,0.5)]",
    bg: "bg-paused/10",
    border: "border-paused/20",
  },
  down: {
    dotBg: "bg-down",
    dotGlow: "shadow-[0_0_12px_rgba(239,68,68,0.5)]",
    bg: "bg-down/10",
    border: "border-down/20",
  },
};

export default function StatusHeader({
  status,
  label,
  totalMonitors,
}: StatusHeaderProps) {
  const config = statusConfig[status];

  return (
    <div
      className={`rounded-2xl ${config.bg} ${config.border} border p-6 sm:p-8 animate-fade-in`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <div
            className={`w-4 h-4 rounded-full ${config.dotBg} ${config.dotGlow} animate-status-pulse`}
          />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-text-primary">
              Firefly Uptime
            </h1>
            <p className="text-text-secondary text-sm">Firefly 服务状态</p>
          </div>
        </div>
        <div className="sm:ml-auto flex items-center gap-3">
          <div
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${config.dotBg}/20 text-white`}
          >
            {label}
          </div>
          <span className="text-text-muted text-sm">
            {totalMonitors} 个监控项
          </span>
        </div>
      </div>
    </div>
  );
}
