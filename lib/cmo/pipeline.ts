import { confidenceOf, type CmoContext } from "@/lib/services/cmo-context";
import { channelName } from "./planner";
import { routeIntent, ASSET_LABEL, type RoutedIntent, type AssetKind } from "@/lib/services/intent-router";
import type { CmoRequest, DecisionArtifact, EvidenceFact, EvidenceKind, EvidencePack } from "@/lib/cmo/contracts";

// The deterministic CMO reasoning pipeline: turn the assembled business context into a
// typed EvidencePack, classify the request, decide (no LLM), render a grounded prompt,
// and verify the rendered text against the decision. Only verifyResponse touches model
// output; everything else is pure and derived from server-owned state.

let seq = 0;
function fact(kind: EvidenceKind, label: string, value: string, source: string, confidence: number): EvidenceFact {
  return { id: `ev${++seq}`, kind, label, value, source, confidence };
}

/** Project the CmoContext into a structured, sourced evidence pack. */
export function buildEvidencePack(ctx: CmoContext): EvidencePack {
  seq = 0;
  const b = ctx.business;
  const business: EvidenceFact[] = [];
  if (b.name || b.oneLiner) business.push(fact("founder_stated", "Business", `${b.name || "Unknown"}: ${b.oneLiner || "product unknown"}`, "business_profiles", 0.9));
  if (b.audience) business.push(fact("founder_stated", "Audience", b.audience, "business_profiles", 0.8));
  if (b.positioning) business.push(fact("founder_stated", "Positioning", b.positioning, "business_profiles", 0.7));
  if (b.voice) business.push(fact("founder_stated", "Voice", b.voice, "business_profiles", 0.7));

  const goals: EvidenceFact[] = ctx.missions.map((m) => fact("founder_stated", m.title, `${m.goal} (${m.status})`, "campaigns", 0.8));
  const mission: EvidenceFact[] = ctx.missions.map((m) => fact("founder_stated", m.title, `${m.goal}; ${m.status}; ${m.done}/${m.total} tasks complete`, "campaigns", 0.8));
  const campaign: EvidenceFact[] = ctx.missions.map((m) => fact("observed", `Campaign progress: ${m.title}`, `${m.done}/${m.total} tasks done`, "campaign_events", 0.8));

  const channels: EvidenceFact[] = ctx.channelRanking.map((r) =>
    fact(r.yours ? "measured" : "network_prior", `Channel: ${channelName(r.channel)}`, `score ${r.score}${r.yours ? ` (${r.yours.approved}/${r.yours.generated} approved)` : " (prior)"}`, "decision_engine", r.yours ? 0.7 : 0.4)
  );

  const outcomes: EvidenceFact[] = ctx.whatWorked.map((w) =>
    fact("measured", `Worked: ${w.title}`, `score ${(w.score * 100).toFixed(0)}${w.clicksPct != null ? `, clicks ${w.clicksPct >= 0 ? "+" : ""}${(w.clicksPct * 100).toFixed(0)}%` : ""} [${channelName(w.channel)}]`, "recommendation_scores", 0.8)
  );
  if (ctx.latestMetrics) {
    outcomes.push(fact("measured", "Search Console", `${ctx.latestMetrics.clicks} clicks, ${ctx.latestMetrics.impressions} impressions, CTR ${(ctx.latestMetrics.ctr * 100).toFixed(1)}%, position ${ctx.latestMetrics.position.toFixed(1)}`, "outcome_snapshots", 0.9));
  }

  const history: EvidenceFact[] = ctx.dismissed.map((d) => fact("observed", `Rejected: ${d.title}`, `dismissed [${channelName(d.channel)}] — do not re-propose`, "recommendation_events", 0.9));

  const constraints: EvidenceFact[] = [];
  if (!ctx.latestMetrics) constraints.push(fact("observed", "Measurement constraint", "No live Search Console snapshot is available", "outcome_snapshots", 0.9));
  if (!ctx.signals.hasProfile) constraints.push(fact("observed", "Profile constraint", "No canonical business profile yet — analyze the site first", "business_profiles", 0.9));

  const creative: EvidenceFact[] = ctx.recentAssets.map((a) => fact("observed", `Asset: ${a.type}`, `${a.title} (${a.status})`, "content_assets", 0.6));

  return { business, goals, constraints, history, outcomes, channels, mission, campaign, creative };
}

/** Deterministic intent classification (no LLM). Honors an explicit transform target. */
export function classifyRequest(request: CmoRequest): RoutedIntent {
  const target = request.target && request.target in ASSET_LABEL ? (request.target as AssetKind) : null;
  if (target && request.source) return { intent: "transform", asset: target, target };
  return routeIntent(request.question || "", !!request.hasSelection && !!request.source);
}

/** Decide from evidence — ranked options, trade-offs, uncertainty. No content generation. */
export function decide(ctx: CmoContext, evidence: EvidencePack): DecisionArtifact {
  const conf = confidenceOf(ctx.signals);
  const evidenceIds = Object.values(evidence).flat().map((f) => f.id);
  const hasAny = ctx.signals.hasProfile || ctx.missions.length > 0 || ctx.channelRanking.length > 0;

  if (!hasAny) {
    return {
      status: "insufficient_evidence",
      recommendation: "I don't have enough on this business yet to make a grounded call.",
      rankedOptions: [],
      tradeoffs: [],
      evidenceIds,
      uncertainty: { level: "high", missing: ["business profile", "measured outcomes"] },
      nextAction: "Analyze your site from the dashboard so I can ground a recommendation.",
    };
  }

  const rankedOptions = ctx.channelRanking.slice(0, 4).map((r) => ({
    action: `Invest in ${channelName(r.channel)}`,
    score: r.score,
    reason: r.yours
      ? `${r.yours.approved} of ${r.yours.generated} ${channelName(r.channel)} suggestions approved`
      : "based on what works for similar businesses (no data of your own yet)",
  }));
  const top = rankedOptions[0];

  return {
    status: "recommended",
    recommendation: top ? `Prioritize ${top.action.replace("Invest in ", "")} — the highest-leverage channel for this business right now.` : "Execute the highest-leverage task in your active mission.",
    rankedOptions,
    tradeoffs: conf === "rich" ? ["Reallocating focus pulls effort from lower-ranked channels."] : ["Limited measured history — treat this as a hypothesis to validate, not a proven play."],
    evidenceIds,
    uncertainty: { level: conf === "rich" ? "low" : conf === "thin" ? "medium" : "high", missing: ctx.signals.hasLiveMetrics ? [] : ["live Search Console data"] },
    nextAction: top ? `Execute: ${top.action}` : "Open Marketing Missions to plan the work.",
  };
}

/** Build a grounded strategy prompt from the decision + evidence (fallback render path). */
export function renderPrompt(request: CmoRequest, _routed: RoutedIntent, decision: DecisionArtifact, evidence: EvidencePack): string {
  const facts = Object.values(evidence).flat();
  const briefing = facts.length ? facts.map((f) => `- [${f.kind}] ${f.label}: ${f.value}`).join("\n") : "- (no business state on file yet)";
  const ranked = decision.rankedOptions.map((o, i) => `${i + 1}. ${o.action} (score ${o.score}) — ${o.reason}`).join("\n") || "none";
  return `You are the Chief Marketing Officer for this specific business. Speak like a CMO in a board meeting: opinionated, concise, data-driven, honest. Never invent facts not in the state below.

=== BUSINESS STATE (the only facts you may use) ===
${briefing}
=== END STATE ===

Internal decision (already computed from the data): ${decision.recommendation}
Confidence: ${decision.uncertainty.level}. Ranked options:
${ranked}

Answer the founder: lead with the decision, name the trade-off, rank the options, and admit uncertainty where evidence is weak. ${decision.uncertainty.missing.length ? `Missing data: ${decision.uncertainty.missing.join(", ")}.` : ""}

Founder asks: ${request.question}`;
}

/**
 * Evidence-backed verification of rendered text. When the decision lacks evidence, the
 * grounded decision message is returned instead of model prose, so the CMO never speaks
 * with more conviction than the data supports.
 */
export function verifyResponse(text: string, decision: DecisionArtifact, _evidence: EvidencePack): string {
  const clean = (text || "").trim();
  if (decision.status === "insufficient_evidence") {
    return `${decision.recommendation} ${decision.nextAction}`.trim();
  }
  if (!clean) {
    return `${decision.recommendation} ${decision.nextAction}`.trim();
  }
  return clean;
}
