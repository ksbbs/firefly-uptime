import { NextResponse } from "next/server";
import { fetchMonitors, getOverallStatus, getIncidents } from "@/lib/uptime-robot";
import type { FormattedMonitor } from "@/lib/types";

export async function GET() {
  const apiKey = process.env.UPTIME_ROBOT_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "UPTIME_ROBOT_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const monitors = await fetchMonitors(apiKey);
    const overall = getOverallStatus(monitors);
    const incidents = getIncidents(monitors);

    return NextResponse.json(
      { monitors, overall, incidents },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (error) {
    console.error("Failed to fetch monitors:", error);
    return NextResponse.json(
      { error: "Failed to fetch monitor data" },
      { status: 502 }
    );
  }
}

export const dynamic = "force-dynamic";
