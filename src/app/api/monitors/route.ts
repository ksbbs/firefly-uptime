import { NextResponse } from "next/server";
import { getStatusPageData } from "@/lib/status-page";

export async function GET() {
  if (!process.env.UPTIME_ROBOT_JWT) {
    return NextResponse.json(
      {
        error: "未配置 API 认证信息",
        hint: "请在 Vercel 环境变量中设置 UPTIME_ROBOT_JWT（v3 JWT Bearer Token）",
      },
      { status: 500 },
    );
  }

  const data = await getStatusPageData();
  if (!data) {
    return NextResponse.json(
      { error: "Failed to fetch monitors" },
      { status: 502 },
    );
  }

  return NextResponse.json(data, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}

export const dynamic = "force-dynamic";
