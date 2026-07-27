import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { assembleSnapshot, loadContext, tenantOf } from "@/lib/execution/api-helpers";
import { executionPlatform } from "@/lib/execution/shared";
import { WORKFLOW_STEPS, STEP_LABEL } from "@/lib/execution/types";

export const runtime = "nodejs";

// One payload for the live Launch Workspace: per-campaign execution, health, platform
// status, notifications and the activity feed. Everything is read from the engines that
// own it — this route computes nothing of its own.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 120 : 40, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = await tenantOf(req.nextUrl.searchParams.get("wsid"));
  const now = Date.now();

  try {
    const ctx = await loadContext(tenant, req.nextUrl.searchParams.get("launchId"));
    const p = executionPlatform();
    const snapshot = await assembleSnapshot(ctx, now);

    const since = Number(req.nextUrl.searchParams.get("since") || 0);
    const activity = since > 0
      ? await p.historyStore.since(tenant, ctx.plan.launchId, since, 40)
      : await p.historyStore.list(tenant, ctx.plan.launchId, 40);

    return NextResponse.json({
      ok: true,
      launchId: ctx.plan.launchId,
      now,
      emergencyStopped: ctx.execution.emergencyStopped,
      queue: ctx.execution.queue,
      steps: WORKFLOW_STEPS.map((s) => ({ step: s, label: STEP_LABEL[s] })),
      campaigns: ctx.plan.campaigns.map((c) => {
        const exec = ctx.execution.campaigns[c.id];
        return {
          campaignId: c.id,
          title: c.title,
          execution: exec ? p.engine.view(exec) : null,
          health: snapshot.healths.find((h) => h.campaignId === c.id) ?? null,
        };
      }),
      overallHealth: p.health.overall(snapshot.healths),
      publishing: snapshot.publishing,
      notifications: snapshot.notifications,
      activity,
    });
  } catch (e) {
    return NextResponse.json({ error: "execution_state_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
