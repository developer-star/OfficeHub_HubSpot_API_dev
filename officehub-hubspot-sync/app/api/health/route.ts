import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET() {
  const now = new Date();
  const sydneyTime = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false
  }).format(now);

  return NextResponse.json({
    ok: true,
    time: now.toISOString(),
    timezone: "Australia/Sydney",
    localTime: sydneyTime
  });
}
