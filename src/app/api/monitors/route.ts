import { NextResponse } from "next/server";
import { fetchMonitors, getOverallStatus, getIncidents } from "@/lib/uptime-robot";

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
    const monitors = await fetchMonitors(jwt);

    // 诊断日志：验证 uptime 比率数据是否正确获取
    if (monitors.length > 0) {
      const firstMonitor = monitors[0];
      console.log(
        `[DIAG] uptimeRatios for "${firstMonitor.name}":`,
        JSON.stringify(firstMonitor.uptimeRatios),
        `downEvents: ${firstMonitor.downEvents.length}`,
      );
    }

    const overall = getOverallStatus(monitors);
    const incidents = getIncidents(monitors);

    // 剥离敏感字段（IP、URL 等）后再返回客户端
    const sanitizedMonitors = monitors.map((m) => {
      const { url: _url, ...rest } = m;
      return rest;
    });
    const sanitizedIncidents = incidents.map((inc) => ({
      ...inc,
      monitorUrl: "",
    }));

    return NextResponse.json(
      {
        monitors: sanitizedMonitors,
        overall,
        incidents: sanitizedIncidents,
        _debug_incident: (globalThis as Record<string, unknown>).__uptime_debug_inc || null,
      },
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
