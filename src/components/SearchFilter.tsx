"use client";

interface SearchFilterProps {
  search: string;
  onSearchChange: (value: string) => void;
  filter: "all" | "up" | "down" | "paused";
  onFilterChange: (value: "all" | "up" | "down" | "paused") => void;
  totalCount: number;
  filteredCount: number;
}

const filters = [
  { value: "all" as const, label: "全部", color: "" },
  { value: "up" as const, label: "正常", color: "bg-up" },
  { value: "down" as const, label: "异常", color: "bg-down" },
  { value: "paused" as const, label: "暂停", color: "bg-paused" },
];

export default function SearchFilter({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  totalCount,
  filteredCount,
}: SearchFilterProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 animate-fade-in stagger-1">
      <div className="relative flex-1">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          placeholder="搜索监控项..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-bg-card border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
        />
      </div>
      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => onFilterChange(f.value)}
            className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
              filter === f.value
                ? "bg-accent/15 text-accent border border-accent/30"
                : "bg-bg-card text-text-secondary border border-border hover:border-text-muted/30"
            }`}
          >
            <span className="flex items-center gap-1.5">
              {f.color && (
                <span
                  className={`w-2 h-2 rounded-full ${f.color}`}
                />
              )}
              {f.label}
            </span>
          </button>
        ))}
      </div>
      {filteredCount !== totalCount && (
        <div className="flex items-center text-xs text-text-muted">
          显示 {filteredCount}/{totalCount}
        </div>
      )}
    </div>
  );
}
