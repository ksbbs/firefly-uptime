import { NextResponse } from "next/server";
import { fetchMonitors, getOverallStatus, getIncidents } from "@/lib/uptime-robot";
import { fetchDeepSeekSnapshot } from "@/lib/deepseek-status";

export async function GET() {
  const jwt = process.env.UPTIME_ROBOT_JWT;

  if (!jwt) {
    return NextResponse.json(
      {
        error: "未配置 API 认证信息",
        hint: "请在 Vercel 环境变量中设置 UPTIME_ROBOT_JWT（v3 JWT Bearer Token）",
      },
      { status: 500 },
    );
  }

  try {
    // UptimeRobot 与 DeepSeek 状态页独立抓取，DeepSeek 失败不影响主数据流
    const [monitors, deepseek] = await Promise.all([
      fetchMonitors(jwt),
      fetchDeepSeekSnapshot().catch((e) => {
        console.warn("[deepseek-status] snapshot failed:", e);
        return null;
      }),
    ]);

    // 诊断日志：验证 uptime 比率数据是否正确获取
    if (monitors.length > 0) {
      const firstMonitor = monitors[0];
      console.log(
        `[DIAG] uptimeRatios for "${firstMonitor.name}":`,
        JSON.stringify(firstMonitor.uptimeRatios),
        `downEvents: ${firstMonitor.downEvents.length}`,
      );
    }

    // 合并 monitors（DeepSeek 合成 monitor 追加在末尾）
    const allMonitors = deepseek
      ? [...monitors, deepseek.monitor]
      : monitors;

    // 合并 incidents（UptimeRobot 历史 + DeepSeek feed），按时间倒序，取前 50
    const allIncidents = deepseek
      ? [...getIncidents(monitors), ...deepseek.incidents]
          .sort((a, b) => b.datetime - a.datetime)
          .slice(0, 50)
      : getIncidents(monitors);

    const overall = getOverallStatus(allMonitors);

    // 剥离敏感字段（IP、URL 等）后再返回客户端
    const sanitizedMonitors = allMonitors.map((m) => {
      const { url: _url, ...rest } = m;
      return rest;
    });
    const sanitizedIncidents = allIncidents.map((inc) => ({
      ...inc,
      monitorUrl: "",
    }));

    return NextResponse.json(
      { monitors: sanitizedMonitors, overall, incidents: sanitizedIncidents },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    console.error("Failed to fetch monitors:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export const dynamic = "force-dynamic";
