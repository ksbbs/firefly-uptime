"use client";

interface ResponseTimeChartProps {
  data: { datetime: number; value: number }[];
}

export default function ResponseTimeChart({ data }: ResponseTimeChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-text-muted text-sm">
        暂无响应时间数据
      </div>
    );
  }

  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const latest = values[values.length - 1];

  const width = data.length * 8 + (data.length - 1) * 2; // 8px bar + 2px gap
  const height = 120;

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="p-2.5 rounded-lg bg-bg-primary/50 border border-border/50">
          <p className="text-text-muted text-[10px]">当前</p>
          <p className="text-text-primary text-sm font-semibold tabular-nums">
            {latest}ms
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-bg-primary/50 border border-border/50">
          <p className="text-text-muted text-[10px]">平均</p>
          <p className="text-text-primary text-sm font-semibold tabular-nums">
            {avg}ms
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-bg-primary/50 border border-border/50">
          <p className="text-text-muted text-[10px]">最大</p>
          <p className="text-down text-sm font-semibold tabular-nums">
            {max}ms
          </p>
        </div>
        <div className="p-2.5 rounded-lg bg-bg-primary/50 border border-border/50">
          <p className="text-text-muted text-[10px]">最小</p>
          <p className="text-up text-sm font-semibold tabular-nums">
            {min}ms
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        {/* Y-axis labels */}
        <div className="absolute -left-1 right-0 top-0 bottom-0 flex flex-col justify-between pointer-events-none">
          <span className="text-[10px] text-text-muted -ml-6">{max}ms</span>
          <span className="text-[10px] text-text-muted -ml-6">{Math.round((max + min) / 2)}ms</span>
          <span className="text-[10px] text-text-muted -ml-6">{min}ms</span>
        </div>

        <div className="overflow-x-auto ml-6 scrollbar-thin">
          <svg width={Math.max(width, 300)} height={height} className="block">
            {/* Grid lines */}
            <line
              x1="0" y1="0" x2={Math.max(width, 300)} y2="0"
              stroke="currentColor" className="text-border" strokeWidth="1"
            />
            <line
              x1="0" y1={height / 2} x2={Math.max(width, 300)} y2={height / 2}
              stroke="currentColor" className="text-border" strokeWidth="0.5"
              strokeDasharray="4 4"
            />
            <line
              x1="0" y1={height} x2={Math.max(width, 300)} y2={height}
              stroke="currentColor" className="text-border" strokeWidth="1"
            />

            {/* Bars */}
            {data.map((d, i) => {
              const barH = Math.max(2, (d.value / range) * height);
              const x = i * 10;
              const y = height - barH;

              // Threshold colors
              let color = "rgba(34, 197, 94, 0.6)"; // green
              if (d.value > avg * 1.5) color = "rgba(234, 179, 8, 0.7)"; // yellow - spike
              if (d.value > avg * 2.5) color = "rgba(239, 68, 68, 0.7)"; // red - high spike

              // Threshold line
              const thresholdLine = avg * 1.5;
              const thY = height - (thresholdLine / range) * height;

              return (
                <g key={i}>
                  {/* Draw bar */}
                  <rect
                    x={x + 1}
                    y={y}
                    width={6}
                    height={barH}
                    rx={2}
                    fill={color}
                    className="transition-all duration-200 hover:opacity-80"
                  />
                  {/* Tooltip on hover */}
                  <title>{`${new Date(d.datetime * 1000).toLocaleString("zh-CN")}: ${d.value}ms`}</title>
                </g>
              );
            })}

            {/* Average line */}
            <line
              x1="0" y1={height - (avg / range) * height} x2={Math.max(width, 300)} y2={height - (avg / range) * height}
              stroke="rgba(245, 158, 11, 0.4)"
              strokeWidth="1"
              strokeDasharray="6 3"
            />
          </svg>
        </div>
        <p className="text-[10px] text-text-muted text-right mt-1">
          平均线 — {avg}ms
        </p>
      </div>
    </div>
  );
}
