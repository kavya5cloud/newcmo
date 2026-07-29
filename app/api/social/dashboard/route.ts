import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { formatInZone } from "@/lib/social/scheduler";

export const runtime = "nodejs";

// One payload for the Publishing Dashboard: accounts, queue metrics, scheduled posts
// (calendar), recent jobs and history.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  const tz = req.nextUrl.searchParams.get("tz") || "UTC";
  const engine = socialEngine();

  const [accounts, jobs, history] = await Promise.all([engine.listAccounts(tenant), engine.listJobs(tenant), engine.listHistory(tenant)]);
  const calendar = jobs.filter((j) => j.state === "scheduled").map((j) => ({
    id: j.id, platform: j.platform, accountId: j.accountId, scheduledAt: j.scheduledAt,
    localTime: j.scheduledAt ? formatInZone(j.scheduledAt, j.timezone || tz) : null, text: j.content.text.slice(0, 80),
  }));

  return NextResponse.json({
    ok: true,
    accounts,
    metrics: engine.metrics(tenant),
    calendar,
    jobs: jobs.slice(0, 30).map((j) => ({ id: j.id, platform: j.platform, state: j.state, attempts: j.attempts, scheduledAt: j.scheduledAt, text: j.content.text.slice(0, 60), error: j.error })),
    history: history.slice(0, 20),
  });
}
