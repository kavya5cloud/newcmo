import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { resolvePlan } from "@/lib/launch/shared";
import { AGENT_PROFILES, TEAM_ORDER } from "@/lib/agents/registry";
import { teamPlatform } from "@/lib/agents/shared";

export const runtime = "nodejs";

// The AI Team dashboard payload: roster, live status, completed work, approvals, queue,
// recommendations and the execution graph. Everything is derived from the task log, so the
// panel can never show a number the tasks don't support.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 120 : 40, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  const campaignId = req.nextUrl.searchParams.get("campaignId") ?? undefined;

  try {
    const plan = await resolvePlan(tenant, req.nextUrl.searchParams.get("launchId"));
    const p = teamPlatform();
    const state = await p.state.get(tenant, plan.launchId);

    return NextResponse.json({
      ok: true,
      launchId: plan.launchId,
      roster: TEAM_ORDER.map((id) => AGENT_PROFILES[id]),
      agents: p.board.summaries(state, campaignId),
      totals: p.board.totals(state, campaignId),
      completed: p.board.completed(state, 30, campaignId),
      waitingApproval: p.board.waitingApproval(state, campaignId),
      queue: p.board.queue(state, campaignId),
      recommendations: p.board.recommendations(state, campaignId),
      graph: p.board.graph(state, campaignId),
    });
  } catch (e) {
    return NextResponse.json({ error: "team_state_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
