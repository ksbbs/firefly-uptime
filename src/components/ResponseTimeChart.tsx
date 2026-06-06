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
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const latest = values[values.length - 1];

  // Y 轴裁剪：用 IQR 盒须图法隔离异常值
  // Q3 + 1.5×IQR 是标准箱线图上须，精准剔除 timeout 极值
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1 || 1;
  const upperFence = q3 + 1.5 * iqr;
  // 图表上限：IQR 上须、或 avg×2、或最大值的 90%（取较小者来裁剪）
  const chartMax = Math.max(
    Math.min(upperFence, sorted[Math.floor(sorted.length * 0.9)], max),
    avg * 2,
    10,
  );
  const isTruncated = max > chartMax;

  const barCount = data.length;
  const chartHeight = 120;

  function formatTooltipTime(ts: number, index: number): string {
    if (ts > 0) {
      return new Date(ts * 1000).toLocaleString("zh-CN");
    }
    const minutesAgo = (barCount - 1 - index) * 5;
    if (minutesAgo === 0) return "最近一次检查";
    if (minutesAgo < 60) return `${minutesAgo} 分钟前`;
    return `${Math.floor(minutesAgo / 60)} 小时前`;
  }

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-4">
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

      {/* Chart — Y 轴裁剪到 chartMax，超出部分截断显示 */}
      <div className="relative pl-8">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between pointer-events-none">
          <span className="text-[10px] text-text-muted -translate-y-1">
            {isTruncated ? `${Math.round(chartMax)}+` : `${max}`}ms
          </span>
          <span className="text-[10px] text-text-muted">
            {Math.round(chartMax / 2)}ms
          </span>
          <span className="text-[10px] text-text-muted translate-y-1">{min}ms</span>
        </div>

        <svg
          viewBox={`0 0 ${barCount * 10} ${chartHeight}`}
          width="100%"
          height={chartHeight}
          className="block"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Grid lines */}
          <line x1="0" y1="0" x2={barCount * 10} y2="0"
            stroke="currentColor" className="text-border" strokeWidth="1" />
          <line x1="0" y1={chartHeight / 2} x2={barCount * 10} y2={chartHeight / 2}
            stroke="currentColor" className="text-border" strokeWidth="0.5"
            strokeDasharray="4 4" />
          <line x1="0" y1={chartHeight} x2={barCount * 10} y2={chartHeight}
            stroke="currentColor" className="text-border" strokeWidth="1" />

          {/* Bars */}
          {data.map((d, i) => {
            const displayVal = Math.min(d.value, chartMax);
            const barH = Math.max(2, (displayVal / chartMax) * chartHeight);
            const x = i * 10;
            const y = chartHeight - barH;

            let color = "rgba(34, 197, 94, 0.6)";
            if (d.value > avg * 1.5) color = "rgba(234, 179, 8, 0.7)";
            if (d.value > avg * 2.5) color = "rgba(239, 68, 68, 0.7)";

            return (
              <g key={i}>
                <rect
                  x={x + 1}
                  y={y}
                  width={6}
                  height={barH}
                  rx={2}
                  fill={color}
                  className="transition-all duration-200 hover:opacity-80"
                />
                {/* 截断标记：超出上界时顶部画红线提示 */}
                {d.value > chartMax && (
                  <line
                    x1={x + 1}
                    y1={y}
                    x2={x + 7}
                    y2={y}
                    stroke="rgba(239, 68, 68, 0.9)"
                    strokeWidth="1.5"
                  />
                )}
                <title>
                  {`${formatTooltipTime(d.datetime, i)}: ${d.value}ms${d.value > chartMax ? " (已截断)" : ""}`}
                </title>
              </g>
            );
          })}

          {/* 截断分隔线（提醒视图已被裁剪） */}
          {isTruncated && (
            <line
              x1="0" y1="1" x2={barCount * 10} y2="1"
              stroke="rgba(239, 68, 68, 0.2)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}

          {/* Average line */}
          <line
            x1="0" y1={chartHeight - (avg / chartMax) * chartHeight}
            x2={barCount * 10} y2={chartHeight - (avg / chartMax) * chartHeight}
            stroke="rgba(245, 158, 11, 0.4)"
            strokeWidth="1"
            strokeDasharray="6 3"
          />
        </svg>

        {isTruncated && (
          <p className="text-[10px] text-down/80 text-right mt-1">
            Y 轴截断于 P95 · 实际最大值 {max}ms
          </p>
        )}
        <p className="text-[10px] text-text-muted text-right mt-1">
          平均线 — {avg}ms
        </p>
      </div>
    </div>
  );
}
