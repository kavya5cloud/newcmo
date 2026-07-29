import { NextRequest, NextResponse } from "next/server";
import { socialEngine } from "@/lib/social/shared";

export const runtime = "nodejs";
export const maxDuration = 60;

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Minute hand for one-off social posts scheduled from Cross-Platform Publishing. */
export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const jobs = await socialEngine().dispatchDue(Date.now());
    return NextResponse.json({
      ok: true,
      at: Date.now(),
      dispatched: jobs.length,
      published: jobs.filter((job) => job.state === "published").length,
      failed: jobs.filter((job) => job.state === "queued" || job.state === "dead_letter").length,
    });
  } catch (error) {
    return NextResponse.json({ error: "cron_failed", detail: String(error).slice(0, 200) }, { status: 503 });
  }
}
