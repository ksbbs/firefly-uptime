import { NextResponse } from "next/server";
import { fetchMonitors, getOverallStatus, getIncidents } from "@/lib/uptime-robot";

export async function GET() {
  // 优先使用 v3 JWT Token
  const jwt = process.env.UPTIME_ROBOT_JWT;
  const apiKey = process.env.UPTIME_ROBOT_API_KEY;

  if (!jwt && !apiKey) {
    return NextResponse.json(
      {
        error: "未配置 API 认证信息",
        hint: "请在 Vercel 环境变量中设置 UPTIME_ROBOT_JWT (v3) 或 UPTIME_ROBOT_API_KEY (v2)",
      },
      { status: 500 }
    );
  }

  try {
    const monitors = jwt
      ? await fetchMonitors(jwt, true) // v3
      : await fetchMonitors(apiKey!, false); // v2 降级
    const overall = getOverallStatus(monitors);
    const incidents = getIncidents(monitors);

    // 剥离敏感字段（IP、URL、端口等）后再返回客户端
    const sanitizedMonitors = monitors.map((m) => {
      const { url: _url, ...rest } = m;
      return rest;
    });
    const sanitizedIncidents = incidents.map((inc) => ({
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
      }
    );
  } catch (error) {
    console.error("Failed to fetch monitors:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 502 }
    );
  }
}

export const dynamic = "force-dynamic";
