import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { assembleCmoContext, confidenceOf, type CmoProfile } from "@/lib/services/cmo-context";
import { classifyRequest } from "@/lib/cmo/pipeline";
import { planDecision, planToArtifact } from "@/lib/cmo/planner";
import { renderCmoPrompt, sanitizeCmoText } from "@/lib/cmo/renderer";
import type { CmoRequest, CmoResponse } from "@/lib/cmo/contracts";
import { buildContentPrompt } from "@/lib/services/content-engine";
import { buildEditPrompt } from "@/lib/services/editor-engine";
import { buildTransformPrompt } from "@/lib/services/transformation-engine";
import { generateText } from "@/lib/services/llm";
import { projectBusinessGraph } from "@/lib/business-graph";
import { fingerprint, persistGraph, persistDecision, appendDecisionEvent, readCachedCmoResponse, writeCachedCmoResponse } from "@/lib/cmo/store";

export const runtime = "nodejs";

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
    // Canonical state → business graph (versioned). The client profile is only a cold-start
    // seed; assembleCmoContext loads the canonical profile from the DB. The graph version is
    // the source of truth for both the cache key and decision provenance.
    const ctx = await assembleCmoContext(sql, workspace, (body.profile || {}) as CmoProfile, String(body.url || ""));
    const graph = await projectBusinessGraph(sql, workspace, ctx.business, String(body.url || ""), ctx);
    await persistGraph(sql, graph);
    const evidence = graph.evidence;
    const graphVersion = graph.version;

    const routed = classifyRequest({ ...body, question });
    // The Decision Planner (deterministic, no LLM) reads the graph, generates + scores
    // multiple candidate strategies, and selects the best → a structured DecisionPlan.
    // It is projected onto the DecisionArtifact the renderer + persistence already consume.
    const plan = planDecision(ctx, evidence, routed, question);
    const decision = planToArtifact(plan, ctx);

    // Cache keyed on graph version — a stale-context reply can never be served.
    const cacheKey = fingerprint(`${workspace}:${graphVersion}:${routed.intent}:${body.source || ""}:${question}`);
    const hit = await readCachedCmoResponse(sql, cacheKey);
    if (hit) return NextResponse.json({ ...hit, cached: true });

    const asset = routed.asset || "x_post";
    const recentTurns = String(body.recentTurns || "").slice(0, 4000);
    // Content/edit/transform render bare deliverables from their engines. Everything
    // conversational (strategy/campaign/analysis/general) goes through the CMO renderer,
    // which owns the voice and never exposes reasoning artifacts.
    const prompt = routed.intent === "content"
      ? buildContentPrompt(ctx, asset, question)
      : routed.intent === "edit" && body.source
        ? buildEditPrompt(ctx, question, body.source)
        : routed.intent === "transform" && body.source && routed.target
          ? buildTransformPrompt(ctx, routed.target, body.source)
          : renderCmoPrompt({ context: ctx, decision, evidence, question, recentTurns });

    // Render via the LLM service directly — no HTTP self-call. Context is already in the
    // prompt (assembled state), so we don't re-scrape the URL here.
    const gen = await generateText({ prompt, sql });
    if (!gen.ok) throw new Error(gen.error);
    const provider: string | undefined = gen.provider;
    const model: string | undefined = gen.model;
    // The renderer/sanitizer is the presentation guarantee: no artifact ever reaches the UI.
    const text = sanitizeCmoText(gen.text);
    const response: CmoResponse = { text, intent: routed.intent, confidence: confidenceOf(ctx.signals), decision, evidence: Object.values(evidence).flat(), cached: false };

    // Persist the decision artifact + evidence (append-only), with model/response metadata,
    // then cache the response against the graph version.
    const decisionId = await persistDecision(sql, workspace, graphVersion, routed.intent, question, decision, response.evidence);
    // Persist the full structured plan (append-only) alongside the rendered event.
    await appendDecisionEvent(sql, decisionId, "planned", { plan });
    await appendDecisionEvent(sql, decisionId, "rendered", { provider: provider || "none", model: model || "none", textLength: text.length, decisionStatus: decision.status });
    await writeCachedCmoResponse(sql, cacheKey, workspace, graphVersion, response);

    console.info(JSON.stringify({
      event: "cmo_plan", workspace, intent: routed.intent, planId: plan.decisionId,
      recommended: plan.recommendedStrategy?.channel, score: plan.recommendedStrategy?.score.total,
      alternatives: plan.alternativeStrategies.map((s) => s.channel), candidates: plan.alternativeStrategies.length + 1,
      expectedImpact: plan.expectedImpact, confidence: plan.confidence, missing: plan.missingInformation.length,
    }));
    console.info(JSON.stringify({ event: "cmo_response", workspace, intent: routed.intent, decision: decision.status, confidence: response.confidence, evidence: response.evidence.length, graphVersion: graphVersion.slice(0, 12), decisionId, model: model || "none", cached: false }));
    return NextResponse.json(response);
  } catch (error) {
    console.info(JSON.stringify({ event: "cmo_response_error", workspace, detail: String(error).slice(0, 200) }));
    return NextResponse.json({ error: "cmo_response_failed" }, { status: 502 });
  }
}
