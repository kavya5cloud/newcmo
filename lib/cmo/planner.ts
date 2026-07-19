import { randomUUID } from "node:crypto";
import { confidenceOf, type CmoContext } from "@/lib/services/cmo-context";
import type { RoutedIntent } from "@/lib/services/intent-router";
import type { DecisionArtifact, EvidencePack } from "@/lib/cmo/contracts";

// ============================================================================
// Marketing Decision Planner — the brain of Populr.
//
// This is DETERMINISTIC. It never calls an LLM to choose a strategy. It reads the
// business state graph, resolves entities, evaluates constraints, generates MULTIPLE
// candidate strategies, scores each on eight criteria, and selects the best — producing
// a structured DecisionPlan. The LLM only explains the plan later (via the renderer),
// working off the DecisionArtifact this planner projects for backwards compatibility.
// ============================================================================

export type Tier = "low" | "medium" | "high";

export type StrategyScore = {
  expectedImpact: number;        // 0..1
  confidence: number;            // 0..1
  cost: number;                  // 0..1 (higher = cheaper)
  time: number;                  // 0..1 (higher = faster)
  risk: number;                  // 0..1 (higher = safer)
  dependencies: number;          // 0..1 (higher = fewer dependencies)
  historicalPerformance: number; // 0..1
  businessAlignment: number;     // 0..1
  total: number;                 // 0..1 weighted
};

export type CandidateStrategy = {
  id: string;
  title: string;
  channel: string;
  rationale: string;
  requiredActions: string[];
  score: StrategyScore;
};

export type ResolvedEntities = {
  channels: string[];
  campaigns: string[];
  competitors: string[];
  assets: string[];
  audiences: string[];
  metrics: string[];
  products: string[];
};

export type DecisionPlan = {
  decisionId: string;
  intent: string;
  goal: string;
  problem: string;
  reasoningSummary: string;
  recommendedStrategy: CandidateStrategy;
  alternativeStrategies: CandidateStrategy[];
  expectedImpact: Tier;
  confidence: Tier;
  requiredActions: string[];
  blockedBy: string[];
  missingInformation: string[];
  supportingEvidence: string[];
  relatedCampaigns: string[];
  relatedAssets: string[];
  relatedOutcomes: string[];
  followUpQuestions: string[];
  entities: ResolvedEntities;
  constraints: string[];
};

// ---- deterministic knowledge tables ---------------------------------------

// Per-channel heuristics (0..1, higher is better on every axis). Combined with the
// workspace's own measured ranking, these give non-LLM strategy scores.
const CHANNEL_PROFILE: Record<string, { impact: number; speed: number; cheapness: number; safety: number; simplicity: number }> = {
  seo: { impact: 0.9, speed: 0.3, cheapness: 0.8, safety: 0.9, simplicity: 0.5 },
  articles: { impact: 0.7, speed: 0.4, cheapness: 0.7, safety: 0.9, simplicity: 0.5 },
  geo: { impact: 0.6, speed: 0.5, cheapness: 0.8, safety: 0.8, simplicity: 0.4 },
  reddit: { impact: 0.6, speed: 0.8, cheapness: 0.9, safety: 0.5, simplicity: 0.7 },
  email: { impact: 0.6, speed: 0.7, cheapness: 0.9, safety: 0.8, simplicity: 0.7 },
  linkedin: { impact: 0.5, speed: 0.8, cheapness: 0.9, safety: 0.8, simplicity: 0.8 },
  x: { impact: 0.5, speed: 0.9, cheapness: 0.9, safety: 0.6, simplicity: 0.8 },
  hn: { impact: 0.5, speed: 0.7, cheapness: 0.9, safety: 0.5, simplicity: 0.7 },
};
const DEFAULT_PROFILE = { impact: 0.5, speed: 0.6, cheapness: 0.8, safety: 0.7, simplicity: 0.6 };

const CHANNEL_ACTIONS: Record<string, string[]> = {
  seo: ["Fix technical SEO — crawlability, metadata, and page speed", "Build high-intent landing pages for your top queries"],
  articles: ["Publish 2–3 cornerstone articles on buyer-intent topics", "Interlink them to your key conversion pages"],
  geo: ["Add crisp definitions and FAQs so AI answers cite you", "Publish comparison content for your core category"],
  reddit: ["Find 3–5 high-intent threads and draft genuinely helpful replies", "Share one case-study post in the most relevant subreddit"],
  email: ["Send a focused launch email to your list", "Set up a short nurture sequence for new signups"],
  linkedin: ["Ship a founder-led post tied to a specific product insight", "Engage in relevant conversations consistently for two weeks"],
  x: ["Post a build-in-public thread about the launch", "Reply in high-signal conversations daily"],
  hn: ["Prepare a Show HN with an honest problem/solution framing", "Time the post for a weekday morning"],
};
const DEFAULT_ACTIONS = ["Draft and ship the first asset for this channel", "Review results before scaling it"];

const SCORE_WEIGHTS = {
  expectedImpact: 0.26,
  historicalPerformance: 0.18,
  businessAlignment: 0.14,
  confidence: 0.14,
  cost: 0.08,
  time: 0.08,
  risk: 0.07,
  dependencies: 0.05,
} as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export function tierOf(x: number): Tier {
  return x >= 0.66 ? "high" : x >= 0.4 ? "medium" : "low";
}

// ---- pure planning steps (unit-tested) ------------------------------------

const METRIC_WORDS = ["traffic", "clicks", "ctr", "impressions", "ranking", "rankings", "position", "conversion", "conversions", "signups", "sign-ups", "revenue", "leads"];
const CHANNEL_WORDS: Record<string, string> = { seo: "seo", search: "seo", reddit: "reddit", linkedin: "linkedin", twitter: "x", " x ": "x", tweet: "x", email: "email", newsletter: "email", blog: "articles", article: "articles", "hacker news": "hn", geo: "geo" };

export function resolveEntities(ctx: CmoContext, question: string): ResolvedEntities {
  const q = ` ${question.toLowerCase()} `;
  const channels = [...new Set(Object.entries(CHANNEL_WORDS).filter(([w]) => q.includes(w)).map(([, c]) => c))];
  const metrics = METRIC_WORDS.filter((m) => q.includes(m));
  return {
    channels,
    campaigns: ctx.missions.map((m) => m.title),
    competitors: ctx.business.competitors ?? [],
    assets: ctx.recentAssets.map((a) => a.title),
    audiences: ctx.business.audience ? [ctx.business.audience] : [],
    metrics,
    products: ctx.business.name ? [ctx.business.name] : [],
  };
}

/** Constraints derived from the state — what's missing or blocking. */
export function evaluateConstraints(ctx: CmoContext): { constraints: string[]; missingInformation: string[]; blockedBy: string[] } {
  const constraints: string[] = [];
  const missingInformation: string[] = [];
  const blockedBy: string[] = [];
  if (!ctx.signals.hasProfile) {
    missingInformation.push("a business profile — analyze the site first");
    blockedBy.push("No analyzed business profile yet");
  }
  if (!ctx.signals.hasLiveMetrics) {
    missingInformation.push("live search performance (Search Console not connected)");
    constraints.push("No live measurement — impact will be a hypothesis until data lands");
  }
  if (ctx.signals.scoredOutcomes === 0) {
    missingInformation.push("measured outcomes to compare against");
    constraints.push("No measured outcome history yet — leaning on channel priors");
  }
  if (ctx.missions.length === 0) constraints.push("No active mission — work isn't tied to a committed plan");
  return { constraints, missingInformation, blockedBy };
}

/** Score one channel strategy deterministically. */
export function scoreStrategy(ctx: CmoContext, channel: string, rankScore: number): StrategyScore {
  const p = CHANNEL_PROFILE[channel] ?? DEFAULT_PROFILE;
  const yours = ctx.channelRanking.find((r) => r.channel === channel)?.yours ?? null;
  const worked = ctx.whatWorked.find((w) => w.channel === channel);

  const expectedImpact = clamp01(0.6 * p.impact + 0.4 * rankScore);
  const confidence = clamp01(
    (ctx.signals.hasLiveMetrics ? 0.3 : 0) +
    (worked ? 0.4 : 0) +
    (yours && yours.generated > 0 ? Math.min(0.3, yours.generated / 20 * 0.3) : 0) +
    0.1
  );
  const historicalPerformance = worked ? clamp01(worked.score) : 0.5;
  const inMission = ctx.missions.some((m) => m.title.toLowerCase().includes(channel));
  const businessAlignment = clamp01(0.5 + (inMission ? 0.2 : 0) + (yours && yours.approved > 0 ? 0.2 : 0));

  const total = clamp01(
    expectedImpact * SCORE_WEIGHTS.expectedImpact +
    historicalPerformance * SCORE_WEIGHTS.historicalPerformance +
    businessAlignment * SCORE_WEIGHTS.businessAlignment +
    confidence * SCORE_WEIGHTS.confidence +
    p.cheapness * SCORE_WEIGHTS.cost +
    p.speed * SCORE_WEIGHTS.time +
    p.safety * SCORE_WEIGHTS.risk +
    p.simplicity * SCORE_WEIGHTS.dependencies
  );

  return {
    expectedImpact, confidence, cost: p.cheapness, time: p.speed, risk: p.safety,
    dependencies: p.simplicity, historicalPerformance, businessAlignment,
    total: Number(total.toFixed(4)),
  };
}

/** Generate multiple candidate strategies (never just one) from the ranked channels. */
export function generateCandidates(ctx: CmoContext): CandidateStrategy[] {
  const ranked = ctx.channelRanking.length
    ? ctx.channelRanking
    : Object.keys(CHANNEL_PROFILE).map((channel) => ({ channel, score: CHANNEL_PROFILE[channel].impact, yours: null }));

  const candidates = ranked.map((r) => {
    const score = scoreStrategy(ctx, r.channel, r.score);
    const worked = ctx.whatWorked.find((w) => w.channel === r.channel);
    const rationale = worked
      ? `${r.channel} has already produced measured wins here (${(worked.score * 100).toFixed(0)}/100), so doubling down compounds a proven play.`
      : ctx.channelRanking.find((c) => c.channel === r.channel)?.yours
        ? `${r.channel} is where your approvals cluster and the decision engine ranks it strongly for this business.`
        : `${r.channel} scores well on impact-vs-effort for a business at this stage, even without first-party data yet.`;
    return {
      id: `strat_${r.channel}`,
      title: `Invest in ${r.channel}`,
      channel: r.channel,
      rationale,
      requiredActions: CHANNEL_ACTIONS[r.channel] ?? DEFAULT_ACTIONS,
      score,
    };
  });
  candidates.sort((a, b) => b.score.total - a.score.total);
  return candidates;
}

// ---- the planner ----------------------------------------------------------

export function planDecision(ctx: CmoContext, evidence: EvidencePack, routed: RoutedIntent, question: string): DecisionPlan {
  const entities = resolveEntities(ctx, question);
  const { constraints, missingInformation, blockedBy } = evaluateConstraints(ctx);
  const candidates = generateCandidates(ctx);

  const recommended = candidates[0];
  const alternatives = candidates.slice(1, 3);

  const activeMission = ctx.missions.find((m) => m.status === "active") || ctx.missions[0];
  const goal = activeMission ? `${activeMission.goal} (${activeMission.title})` : routed.intent === "campaign" ? "grow the business" : "improve marketing performance";
  const brand = ctx.business.name || "this business";

  const problem = !ctx.signals.hasProfile
    ? `Populr doesn't yet know enough about ${brand} to plan with confidence.`
    : ctx.signals.scoredOutcomes === 0
      ? `${brand} is investing effort without measured proof of what works — spread too thin risks wasted cycles.`
      : `${brand} needs to concentrate effort on the channel with the best evidence-backed return.`;

  const reasoningSummary = recommended
    ? `Scored ${candidates.length} channel strategies on impact, historical performance, alignment, confidence, cost, speed, risk and dependencies. ${recommended.channel} leads (${(recommended.score.total * 100).toFixed(0)}/100)${alternatives[0] ? `, ahead of ${alternatives[0].channel} (${(alternatives[0].score.total * 100).toFixed(0)}/100)` : ""}.`
    : "No channels available to plan against yet.";

  const relatedOutcomes = ctx.whatWorked.map((w) => `${w.title} [${w.channel}]`);
  const followUpQuestions: string[] = [];
  if (!ctx.business.audience) followUpQuestions.push("Who's your primary buyer?");
  if (entities.channels.length === 0 && routed.intent === "strategy" && ctx.missions.length === 0) {
    // no strong signal — but never spam questions; one at most
  }

  return {
    decisionId: randomUUID(),
    intent: routed.intent,
    goal,
    problem,
    reasoningSummary,
    recommendedStrategy: recommended,
    alternativeStrategies: alternatives,
    expectedImpact: tierOf(recommended?.score.expectedImpact ?? 0),
    confidence: tierOf(recommended?.score.confidence ?? 0),
    requiredActions: recommended?.requiredActions ?? [],
    blockedBy,
    missingInformation,
    supportingEvidence: Object.values(evidence).flat().map((f) => f.label),
    relatedCampaigns: entities.campaigns,
    relatedAssets: entities.assets,
    relatedOutcomes,
    followUpQuestions: followUpQuestions.slice(0, 1),
    entities,
    constraints,
  };
}

/**
 * Project the DecisionPlan onto the DecisionArtifact the renderer + persistence already
 * consume — so the conversation layer and storage stay unchanged (backwards compatible).
 */
export function planToArtifact(plan: DecisionPlan, ctx: CmoContext): DecisionArtifact {
  const conf = confidenceOf(ctx.signals);
  const hasAny = ctx.signals.hasProfile || ctx.missions.length > 0 || ctx.channelRanking.length > 0;
  const status: DecisionArtifact["status"] = !hasAny
    ? "insufficient_evidence"
    : plan.followUpQuestions.length
      ? "needs_clarification"
      : "recommended";

  return {
    status,
    recommendation: plan.recommendedStrategy
      ? `Prioritize ${plan.recommendedStrategy.channel} — ${plan.recommendedStrategy.rationale}`
      : plan.reasoningSummary,
    rankedOptions: [plan.recommendedStrategy, ...plan.alternativeStrategies]
      .filter(Boolean)
      .map((s) => ({ action: s.title, score: s.score.total, reason: s.rationale })),
    tradeoffs: plan.constraints,
    evidenceIds: plan.supportingEvidence,
    uncertainty: { level: conf === "rich" ? "low" : conf === "thin" ? "medium" : "high", missing: plan.missingInformation },
    nextAction: plan.requiredActions[0] || "Open Marketing Missions to plan the work.",
  };
}
