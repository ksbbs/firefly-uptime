import { getStatusPageData } from "@/lib/status-page";
import StatusPageClient from "./StatusPageClient";

// ISR：每 30s revalidate 一次，配合 globalThis warm cache 让冷启动也能秒返
export const revalidate = 30;

function ConfigError() {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center">
      <div className="text-center p-8 max-w-md animate-fade-in">
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
        <p className="text-text-secondary text-sm">
          请确保已配置 UPTIME_ROBOT_JWT 环境变量
        </p>
      </div>
    </div>
  );
}

export default async function Home() {
  const data = await getStatusPageData();

  if (!data) return <ConfigError />;

  return <StatusPageClient initialData={data} />;
}
