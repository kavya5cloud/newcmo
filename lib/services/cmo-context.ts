import type { Sql } from "@/lib/db";
import { rankChannels } from "@/lib/services/decisions";
import { ensureIntelTables } from "@/lib/intel";
import { ensureCampaignTables } from "@/lib/services/campaigns";

/**
 * The CMO Context Assembler — the reason Populr's AI stops sounding like ChatGPT.
 *
 * A generic chatbot answers from the question alone. A Chief Marketing Officer answers
 * from everything they know about THIS business. This module deterministically pulls the
 * business's own decision/outcome history (NO LLM) and assembles it in the exact order a
 * CMO reasons:
 *
 *   Business → Goals → Constraints → Historical decisions → Outcomes →
 *   Channels → Current mission → Campaign context → Recommendation
 *
 * The LLM is used only for the final natural-language rendering of a decision that has
 * already been grounded in real data. Everything upstream is SQL + the decision engine.
 */

export type CmoProfile = {
  name?: string; oneLiner?: string; audience?: string;
  positioning?: string; voice?: string; competitors?: string[];
};

export type CmoContext = {
  business: CmoProfile & { url: string };
  missions: { title: string; goal: string; status: string; done: number; total: number }[];
  channelRanking: { channel: string; score: number; yours: { generated: number; approved: number } | null }[];
  whatWorked: { title: string; channel: string; score: number; clicksPct: number | null }[];
  dismissed: { title: string; channel: string }[];
  latestMetrics: { site: string; clicks: number; impressions: number; ctr: number; position: number; capturedAt: string } | null;
  recentAssets: { type: string; title: string; status: string }[];
  signals: ContextSignals;
};

export type ContextSignals = {
  hasProfile: boolean;
  missionCount: number;
  scoredOutcomes: number;   // recommendations with a measured before/after
  approvedActions: number;
  dismissedActions: number;
  hasLiveMetrics: boolean;
};

export type Confidence = "rich" | "thin" | "cold";

// ---- pure (unit-tested) ---------------------------------------------------

/**
 * How much real evidence backs an answer. Drives whether the CMO speaks with
 * conviction, hedges, or explicitly admits it's reasoning from first principles.
 *   cold — no history at all; only the profile (or not even that)
 *   thin — some activity, but no measured outcomes yet
 *   rich — measured outcomes exist (the CMO can cite what actually worked)
 */
export function confidenceOf(s: ContextSignals): Confidence {
  if (s.scoredOutcomes >= 1 || (s.missionCount >= 1 && s.hasLiveMetrics)) return "rich";
  if (s.hasProfile && (s.missionCount >= 1 || s.approvedActions >= 1 || s.hasLiveMetrics)) return "thin";
  return "cold";
}

function n(v: unknown): number { const x = Number(v); return Number.isFinite(x) ? x : 0; }

/**
 * The canonical business profile — the latest server-persisted version from
 * business_profiles. This is the source of truth. A browser-supplied profile is NEVER
 * trusted for reads; it may only seed the record before the first analysis persists one.
 */
export async function loadCanonicalProfile(sql: Sql, wsKey: string): Promise<CmoProfile | null> {
  try {
    const rows = (await sql`
      SELECT profile FROM business_profiles
      WHERE workspace_key = ${wsKey} ORDER BY version DESC LIMIT 1`) as unknown as { profile: CmoProfile }[];
    return rows[0]?.profile ?? null;
  } catch {
    return null;
  }
}

// ---- assembly (deterministic I/O, no LLM) --------------------------------

// `seedProfile` is the browser-supplied profile. It is used ONLY as a fallback when the
// workspace has no canonical profile yet (cold start, before the first analysis persists
// one). Whenever a canonical profile exists, it wins — the request body cannot override it.
export async function assembleCmoContext(sql: Sql, wsKey: string, seedProfile: CmoProfile, url: string, ensureTables = true): Promise<CmoContext> {
  if (ensureTables) {
    await ensureIntelTables(sql);
    await ensureCampaignTables(sql);
  }

  const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };

  const [missionsRaw, ranking, workedRaw, dismissedRaw, snapRaw, assetsRaw, canonicalProfile] = await Promise.all([
    safe(sql`
      SELECT c.title, c.goal, c.status, jsonb_array_length(c.tasks) AS total,
             COALESCE((SELECT COUNT(DISTINCT (e.metadata->>'taskIndex'))
                       FROM campaign_events e WHERE e.campaign_id = c.id AND e.event = 'task_done'), 0) AS done
      FROM campaigns c WHERE c.workspace_key = ${wsKey} AND c.status != 'archived'
      ORDER BY c.created_at DESC LIMIT 5` as unknown as Promise<{ title: string; goal: string; status: string; total: number; done: number }[]>, []),
    safe(rankChannels(sql, wsKey, ensureTables), []),
    safe(sql`
      SELECT r.title, r.channel, s.association_score, s.delta
      FROM recommendation_scores s JOIN recommendations r ON r.id = s.recommendation_id
      WHERE r.workspace_key = ${wsKey}
      ORDER BY s.association_score DESC LIMIT 5` as unknown as Promise<{ title: string; channel: string; association_score: number; delta: { clicks?: { pct: number } } }[]>, []),
    safe(sql`
      SELECT DISTINCT r.title, r.channel FROM recommendations r
      JOIN recommendation_events e ON e.recommendation_id = r.id AND e.event = 'dismissed'
      WHERE r.workspace_key = ${wsKey} LIMIT 5` as unknown as Promise<{ title: string; channel: string }[]>, []),
    safe(sql`
      SELECT site_url, metrics, captured_at FROM outcome_snapshots
      WHERE workspace_key = ${wsKey} ORDER BY captured_at DESC LIMIT 1` as unknown as Promise<{ site_url: string; metrics: { clicks: number; impressions: number; ctr: number; position: number }; captured_at: string }[]>, []),
    safe(sql`
      SELECT asset_type, title, status FROM content_assets
      WHERE workspace_key = ${wsKey} ORDER BY created_at DESC LIMIT 6` as unknown as Promise<{ asset_type: string; title: string; status: string }[]>, []),
    safe(loadCanonicalProfile(sql, wsKey), null),
  ]);

  // Canonical (server-persisted) profile wins; the browser seed is only used until the
  // first analysis persists a canonical record. The request body can never override state.
  const profile: CmoProfile = canonicalProfile ?? seedProfile ?? {};

  const missions = missionsRaw.map((m) => ({ title: m.title, goal: m.goal, status: m.status, done: n(m.done), total: n(m.total) }));
  const whatWorked = workedRaw.map((w) => ({
    title: w.title, channel: w.channel, score: n(w.association_score),
    clicksPct: w.delta?.clicks?.pct != null ? n(w.delta.clicks.pct) : null,
  }));
  const dismissed = dismissedRaw.map((d) => ({ title: d.title, channel: d.channel }));
  const snap = snapRaw[0];
  const latestMetrics = snap ? {
    site: snap.site_url, clicks: n(snap.metrics.clicks), impressions: n(snap.metrics.impressions),
    ctr: n(snap.metrics.ctr), position: n(snap.metrics.position), capturedAt: snap.captured_at,
  } : null;

  const signals: ContextSignals = {
    hasProfile: !!(profile.name || profile.oneLiner),
    missionCount: missions.length,
    scoredOutcomes: whatWorked.length,
    approvedActions: ranking.reduce((a, r) => a + (r.evidence.yours?.approved ?? 0), 0),
    dismissedActions: dismissed.length,
    hasLiveMetrics: !!latestMetrics,
  };

  return {
    business: { ...profile, url },
    missions,
    channelRanking: ranking.slice(0, 5).map((r) => ({ channel: r.channel, score: r.score, yours: r.evidence.yours ? { generated: r.evidence.yours.generated, approved: r.evidence.yours.approved } : null })),
    whatWorked, dismissed, latestMetrics,
    recentAssets: assetsRaw.map((a) => ({ type: a.asset_type, title: a.title, status: a.status })),
    signals,
  };
}

// ---- rendering (pure) -----------------------------------------------------

/** The business state graph, rendered in CMO reasoning order. Facts only — no advice. */
export function renderBriefing(ctx: CmoContext): string {
  const b = ctx.business;
  const lines: string[] = [];

  lines.push("[BUSINESS]");
  lines.push(`- ${b.name || "Unknown brand"} — ${b.oneLiner || "product unknown"}`);
  if (b.audience) lines.push(`- Audience: ${b.audience}`);
  if (b.positioning) lines.push(`- Positioning: ${b.positioning}`);
  if (b.voice) lines.push(`- Voice: ${b.voice}`);
  if (b.competitors?.length) lines.push(`- Competitors: ${b.competitors.join(", ")}`);

  lines.push("\n[CURRENT GOALS — active missions]");
  lines.push(ctx.missions.length
    ? ctx.missions.map((m) => `- ${m.title} (${m.goal}, ${m.status}, ${m.done}/${m.total} tasks done)`).join("\n")
    : "- No active missions. This business has not committed to a plan yet.");

  lines.push("\n[CHANNEL EFFECTIVENESS — decision engine ranking, from measured data]");
  lines.push(ctx.channelRanking.length
    ? ctx.channelRanking.map((r) => `- ${r.channel}: score ${r.score}${r.yours ? ` (you: ${r.yours.approved}/${r.yours.generated} approved)` : " (no first-party data — prior)"}`).join("\n")
    : "- No ranking available.");

  lines.push("\n[WHAT ACTUALLY WORKED — measured recommendation outcomes]");
  lines.push(ctx.whatWorked.length
    ? ctx.whatWorked.map((w) => `- ${w.title} [${w.channel}] score ${(w.score * 100).toFixed(0)}${w.clicksPct != null ? `, clicks ${w.clicksPct >= 0 ? "+" : ""}${(w.clicksPct * 100).toFixed(0)}%` : ""}`).join("\n")
    : "- No measured outcomes yet. Do NOT claim anything has been proven to work.");

  if (ctx.dismissed.length) {
    lines.push("\n[REJECTED — the founder dismissed these; don't re-propose them]");
    lines.push(ctx.dismissed.map((d) => `- ${d.title} [${d.channel}]`).join("\n"));
  }

  lines.push("\n[LIVE METRICS]");
  lines.push(ctx.latestMetrics
    ? `- Search Console (${ctx.latestMetrics.site}): ${ctx.latestMetrics.clicks} clicks, ${ctx.latestMetrics.impressions} impressions, CTR ${(ctx.latestMetrics.ctr * 100).toFixed(1)}%, avg position ${ctx.latestMetrics.position.toFixed(1)}`
    : "- No live Search Console data. Any traffic figure you state is an estimate — say so.");

  if (ctx.recentAssets.length) {
    lines.push("\n[RECENT CREATIVE]");
    lines.push(ctx.recentAssets.map((a) => `- ${a.type}: ${a.title} (${a.status})`).join("\n"));
  }

  return lines.join("\n");
}

const CONFIDENCE_RULE: Record<Confidence, string> = {
  rich: "You have measured outcomes for this business. Speak with conviction and cite what worked. Rank your options.",
  thin: "You have this business's profile and some activity but NO measured outcomes yet. Give a clear recommendation, but flag that it is a hypothesis to be tested, not proven.",
  cold: "You have little to no history for this business. Do NOT fabricate outcomes or pretend to know what worked. Make ONE grounded recommendation from the profile, state plainly that it's a starting hypothesis, and name the single piece of data you'd want next.",
};

/**
 * The decide-first reasoning prompt. The model is told to reason through the business
 * state graph in order and only THEN speak — as a CMO in a board meeting, not an assistant.
 */
export function buildCmoPrompt(ctx: CmoContext, question: string, mode: "strategy" | "copy", recentTurns: string): string {
  const confidence = confidenceOf(ctx.signals);
  const modeLine = mode === "copy"
    ? "This is a COPY request: return paste-ready language (hooks, headlines, body), on-voice, no meta-commentary."
    : "This is a STRATEGY request: return a decision — the highest-leverage action, ranked against alternatives, with the trade-off named.";

  return `You are the Chief Marketing Officer for ${ctx.business.name || "this business"}. You have spent months inside this specific company. You are in a board meeting: opinionated, strategic, concise, data-driven, honest. You are NOT a friendly assistant and you never explain marketing concepts unless explicitly asked.

Reason silently through the business state below IN THIS ORDER before writing anything:
business → current goals → constraints → what was decided before → what actually worked → channel effectiveness → active mission → then your recommendation.

=== BUSINESS STATE (the only facts you may use) ===
${renderBriefing(ctx)}
=== END STATE ===

EVIDENCE LEVEL: ${confidence.toUpperCase()}. ${CONFIDENCE_RULE[confidence]}

Rules:
- Ground every claim in the state above. Never invent metrics, competitors, or outcomes not listed.
- Reference this business's own past campaigns/outcomes when relevant. Don't re-propose rejected ideas.
- Lead with the decision, not background. Prioritize action over theory. Name trade-offs. Rank options when there are several.
- If the question genuinely cannot be answered from the state, say exactly what's missing and ask ONE sharp clarifying question — then still give your best provisional call.
- ${modeLine}
- Keep it tight: 2–5 short paragraphs or bullet groups. No preamble, no "as an AI".

Recent conversation:
${recentTurns || "none"}

Founder asks: ${question}`;
}
