import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { marketPlatform } from "@/lib/market/shared";
import { activityEvent } from "@/lib/execution/history";
import { currentDay, loadContext, tenantOf } from "@/lib/execution/api-helpers";
import { executionPlatform } from "@/lib/execution/shared";

export const runtime = "nodejs";

// Adaptive timeline — Market Intelligence proposing changes to a running launch.
//
// GET derives proposals with their evidence; POST records a decision. Approving a proposal
// records the authorisation; it does not silently rewrite the plan. Nothing in this route
// mutates a campaign.

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = await tenantOf(req.nextUrl.searchParams.get("wsid"));
  try {
    const ctx = await loadContext(tenant, req.nextUrl.searchParams.get("launchId"));
    const p = executionPlatform();

    let market = { trends: [], competitors: [], opportunities: [] } as Parameters<typeof p.adaptive.propose>[1];
    let degraded = false;
    try {
      const brief = await marketPlatform().research.run({
        tenant, terms: [ctx.plan.mission], competitors: [], industry: "saas",
        audience: ctx.plan.campaigns[0]?.brief?.audience ?? "founders",
      });
      market = {
        trends: brief.trends.map((t) => ({ topic: t.topic, confidence: t.confidence, velocity: t.velocity })),
        competitors: brief.competitors.map((c) => ({ name: c.name, summary: c.summary, engagementTrend: c.engagementTrend })),
        opportunities: brief.opportunities.map((o) => ({
          id: o.id, title: o.title, recommendedAction: o.recommendedAction, confidence: o.confidence, urgency: o.urgency,
        })),
      };
    } catch { degraded = true; }

    const decided = await p.adaptations.decisions(tenant, ctx.plan.launchId)
      .catch((): Awaited<ReturnType<typeof p.adaptations.decisions>> => ({}));
    const proposals = p.adaptive
      .propose(ctx.plan, market, { currentDay: currentDay(ctx.plan, ctx.execution, Date.now()) })
      .map((x) => decided[x.id] ?? x);

    return NextResponse.json({ ok: true, degraded, proposals });
  } catch (e) {
    return NextResponse.json({ error: "adaptive_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const decision = String(body.decision || "");
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "invalid_decision", hint: "approved | rejected" }, { status: 422 });
  }
  const proposal = body.proposal as Parameters<ReturnType<typeof executionPlatform>["adaptive"]["decide"]>[0] | undefined;
  if (!proposal?.id) return NextResponse.json({ error: "missing_proposal" }, { status: 422 });

  const tenant = await tenantOf((body.wsid as string) ?? null);
  try {
    const ctx = await loadContext(tenant, (body.launchId as string) ?? null);
    const p = executionPlatform();
    const now = Date.now();
    const decided = p.adaptive.decide(proposal, decision, now);
    await p.adaptations.record(tenant, ctx.plan.launchId, decided);
    await p.historyStore.append(activityEvent({
      tenant, launchId: ctx.plan.launchId, campaignId: decided.campaignId,
      kind: "timeline_optimized",
      message: `Adaptation ${decision}: ${decided.title}`,
      at: now, meta: { type: decided.type },
    }));
    return NextResponse.json({
      ok: true, proposal: decided,
      message: decision === "approved"
        ? "Approved and recorded. Apply it from the timeline when you're ready — nothing was changed automatically."
        : "Rejected. It won't be proposed again unless the evidence changes.",
    });
  } catch (e) {
    return NextResponse.json({ error: "decision_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
