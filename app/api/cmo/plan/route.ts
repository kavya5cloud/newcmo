import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { assembleCmoContext, type CmoProfile } from "@/lib/services/cmo-context";
import { buildEvidencePack, classifyRequest } from "@/lib/cmo/pipeline";
import { planDecision } from "@/lib/cmo/planner";
import type { CmoRequest } from "@/lib/cmo/contracts";

export const runtime = "nodejs";

// Planner API — returns the structured DecisionPlan for a question WITHOUT rendering it.
// Fully deterministic (no LLM): reads the graph, generates + scores candidate strategies,
// selects the best. Useful for inspection, debugging, and downstream tools.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 12, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const sql = db();
  if (!sql) return NextResponse.json({ error: "no_database" }, { status: 503 });

  let body: CmoRequest;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const question = String(body.question || "").trim().slice(0, 2000);
  if (!question) return NextResponse.json({ error: "empty_question" }, { status: 400 });
  const workspace = await workspaceKey(body.wsid ?? null);
  if (!workspace) return NextResponse.json({ error: "no_key" }, { status: 400 });

  try {
    const ctx = await assembleCmoContext(sql, workspace, (body.profile || {}) as CmoProfile, String(body.url || ""));
    const evidence = buildEvidencePack(ctx);
    const routed = classifyRequest({ ...body, question });
    const plan = planDecision(ctx, evidence, routed, question);
    console.info(JSON.stringify({
      event: "cmo_plan_api", workspace, intent: routed.intent, planId: plan.decisionId,
      recommended: plan.recommendedStrategy?.channel, candidates: plan.alternativeStrategies.length + 1,
    }));
    return NextResponse.json({ ok: true, plan });
  } catch (e) {
    console.info(JSON.stringify({ event: "cmo_plan_error", workspace, detail: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "plan_failed" }, { status: 502 });
  }
}
