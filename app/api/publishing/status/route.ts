import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { createLaunch } from "@/lib/launch/engine";
import { LAUNCH_TEMPLATE_IDS } from "@/lib/launch/templates";
import type { LaunchInput, LaunchTemplateId } from "@/lib/launch/types";
import { PublishingEngine } from "@/lib/publishing";

export const runtime = "nodejs";

// Publishing Status — load a launch's schedule into the engine and report the lifecycle
// stage distribution plus the emitted event counts. Deterministic (fixed clock).
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const launchType = String(req.nextUrl.searchParams.get("launchType") || "ai_tool_launch");
  if (!(LAUNCH_TEMPLATE_IDS as readonly string[]).includes(launchType)) {
    return NextResponse.json({ error: "invalid_launch_type" }, { status: 422 });
  }
  const input: LaunchInput = {
    launchType: launchType as LaunchTemplateId,
    mission: String(req.nextUrl.searchParams.get("mission") || "Launch"),
    business: { name: "Populr", audience: "founders" },
    timelineDays: 28,
  };
  const plan = createLaunch(input);
  const engine = new PublishingEngine({ dependencyGraph: plan.dependencies });
  engine.load(plan.publishingSchedule);

  return NextResponse.json({
    ok: true,
    launchId: plan.launchId,
    summary: engine.summary(),
    events: engine.bus.counts(),
    items: engine.all().map((i) => ({ assetKey: i.assetKey, stage: i.stage, failed: i.failed })),
  });
}
