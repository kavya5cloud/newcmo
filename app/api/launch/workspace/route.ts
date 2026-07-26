import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { analyzeLaunch } from "@/lib/launch/recommendations";
import { resolvePlan, workspaceStateRepo } from "@/lib/launch/shared";
import {
  AUTOMATION_KEYS, applyItemAction, applyMissionEdit, campaignProgress, effectiveMission,
  emptyState, isItemAction, setAutomation, workspaceSummary,
  type AutomationKey, type MissionEdit,
} from "@/lib/launch/workspace";

export const runtime = "nodejs";

// Launch Workspace state — what the founder has actually done on top of the deterministic
// plan. GET returns plan + execution state + derived progress; POST applies one action.
// The plan is never re-planned here; the Launch Engine remains its only author.

async function tenantOf(v: string | null) {
  return (await workspaceKey(v)) ?? "default";
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = await tenantOf(req.nextUrl.searchParams.get("wsid"));
  const launchId = req.nextUrl.searchParams.get("launchId");
  const plan = await resolvePlan(tenant, launchId);

  // Execution state is an overlay: if it can't be read, show the plan rather than an error
  // page, and say so, so nobody mistakes a storage outage for "nothing done yet".
  let state = emptyState(tenant, plan.launchId);
  let degraded = false;
  try { state = await workspaceStateRepo().get(tenant, plan.launchId); }
  catch { degraded = true; }

  return NextResponse.json({
    ok: true, degraded,
    launchId: plan.launchId,
    mission: effectiveMission(plan, state),
    items: state.items,
    automation: state.automation,
    progress: campaignProgress(plan, state),
    summary: workspaceSummary(plan, state),
    recommendations: analyzeLaunch(plan),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 15, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const tenant = await tenantOf((body.wsid as string) ?? null);
  const plan = await resolvePlan(tenant, (body.launchId as string) ?? null);
  const repo = workspaceStateRepo();
  let state;
  try { state = await repo.get(tenant, plan.launchId); }
  catch { return NextResponse.json({ error: "state_unavailable" }, { status: 503 }); }

  const op = String(body.op || "");
  if (op === "item") {
    const assetKey = String(body.assetKey || "");
    if (!assetKey) return NextResponse.json({ error: "missing_assetKey" }, { status: 422 });
    if (!isItemAction(body.action)) return NextResponse.json({ error: "invalid_action" }, { status: 422 });
    state = applyItemAction(state, assetKey, body.action);
  } else if (op === "bulkItems") {
    const keys = Array.isArray(body.assetKeys) ? body.assetKeys.map(String) : [];
    if (!isItemAction(body.action)) return NextResponse.json({ error: "invalid_action" }, { status: 422 });
    for (const k of keys) state = applyItemAction(state, k, body.action);
  } else if (op === "automation") {
    const key = String(body.key || "") as AutomationKey;
    if (!AUTOMATION_KEYS.includes(key)) return NextResponse.json({ error: "invalid_automation_key" }, { status: 422 });
    state = setAutomation(state, key, Boolean(body.on));
  } else if (op === "mission") {
    const edit = (body.mission ?? {}) as MissionEdit;
    state = applyMissionEdit(state, edit);
  } else {
    return NextResponse.json({ error: "invalid_op", hint: "item | bulkItems | automation | mission" }, { status: 422 });
  }

  try { await repo.save(state); }
  catch { return NextResponse.json({ error: "save_failed" }, { status: 503 }); }

  return NextResponse.json({
    ok: true,
    launchId: plan.launchId,
    mission: effectiveMission(plan, state),
    items: state.items,
    automation: state.automation,
    progress: campaignProgress(plan, state),
    summary: workspaceSummary(plan, state),
  });
}
