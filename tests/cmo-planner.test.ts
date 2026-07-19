import { describe, it, expect } from "vitest";
import { generateCandidates, scoreStrategy, planDecision, resolveEntities, evaluateConstraints, tierOf, planToArtifact } from "@/lib/cmo/planner";
import type { CmoContext } from "@/lib/services/cmo-context";
import type { EvidencePack } from "@/lib/cmo/contracts";
import type { RoutedIntent } from "@/lib/services/intent-router";

const evidence: EvidencePack = { business: [{ id: "ev1", kind: "founder_stated", label: "Business", value: "Populr: AI CMO", source: "business_profiles", confidence: 0.9 }], goals: [], constraints: [], history: [], outcomes: [], channels: [], mission: [], campaign: [], creative: [] };
const routed: RoutedIntent = { intent: "strategy", asset: null, target: null };

function ctx(overrides: Partial<CmoContext> = {}): CmoContext {
  return {
    business: { name: "Populr", oneLiner: "AI CMO", audience: "founders", competitors: ["okara"], url: "https://x.test" },
    missions: [],
    channelRanking: [
      { channel: "seo", score: 0.62, yours: null },
      { channel: "reddit", score: 0.55, yours: { generated: 4, approved: 2 } },
      { channel: "linkedin", score: 0.48, yours: null },
      { channel: "x", score: 0.46, yours: null },
    ],
    whatWorked: [],
    dismissed: [],
    latestMetrics: null,
    recentAssets: [{ type: "blog", title: "Launch post", status: "approved" }],
    signals: { hasProfile: true, missionCount: 0, scoredOutcomes: 0, approvedActions: 2, dismissedActions: 0, hasLiveMetrics: false },
    ...overrides,
  };
}

describe("tierOf", () => {
  it("buckets 0..1 into low/medium/high", () => {
    expect(tierOf(0.1)).toBe("low");
    expect(tierOf(0.5)).toBe("medium");
    expect(tierOf(0.8)).toBe("high");
  });
});

describe("generateCandidates", () => {
  it("never generates only one strategy", () => {
    expect(generateCandidates(ctx()).length).toBeGreaterThanOrEqual(2);
  });
  it("returns candidates sorted by total score (best first)", () => {
    const c = generateCandidates(ctx());
    for (let i = 1; i < c.length; i++) expect(c[i - 1].score.total).toBeGreaterThanOrEqual(c[i].score.total);
  });
  it("falls back to default channels when no ranking is available", () => {
    expect(generateCandidates(ctx({ channelRanking: [] })).length).toBeGreaterThanOrEqual(3);
  });
});

describe("scoreStrategy", () => {
  it("rewards measured historical performance", () => {
    const withWin = ctx({ whatWorked: [{ title: "ranked #1", channel: "seo", score: 0.9, clicksPct: 0.4 }] });
    const s1 = scoreStrategy(withWin, "seo", 0.62);
    const s0 = scoreStrategy(ctx(), "seo", 0.62);
    expect(s1.historicalPerformance).toBeGreaterThan(s0.historicalPerformance);
    expect(s1.total).toBeGreaterThan(s0.total);
  });
  it("all sub-scores and total stay within [0,1]", () => {
    const s = scoreStrategy(ctx(), "reddit", 0.55);
    for (const v of Object.values(s)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe("resolveEntities", () => {
  it("resolves channels + metrics from the question and entities from context", () => {
    const e = resolveEntities(ctx(), "why is my SEO traffic dropping vs reddit?");
    expect(e.channels).toContain("seo");
    expect(e.channels).toContain("reddit");
    expect(e.metrics).toContain("traffic");
    expect(e.competitors).toContain("okara");
    expect(e.audiences).toContain("founders");
  });
});

describe("evaluateConstraints", () => {
  it("flags missing measurement and profile", () => {
    const c = evaluateConstraints(ctx({ signals: { ...ctx().signals, hasLiveMetrics: false, scoredOutcomes: 0 } }));
    expect(c.missingInformation.join(" ")).toMatch(/search performance/i);
    const cold = evaluateConstraints(ctx({ signals: { ...ctx().signals, hasProfile: false } }));
    expect(cold.blockedBy.length).toBeGreaterThan(0);
  });
});

describe("planDecision", () => {
  it("produces a full DecisionPlan with a recommendation and alternatives", () => {
    const plan = planDecision(ctx(), evidence, routed, "what should I focus on?");
    expect(plan.decisionId).toBeTruthy();
    expect(plan.recommendedStrategy).toBeTruthy();
    expect(plan.alternativeStrategies.length).toBeGreaterThanOrEqual(1);
    // the recommended strategy outscores every alternative
    for (const a of plan.alternativeStrategies) expect(plan.recommendedStrategy.score.total).toBeGreaterThanOrEqual(a.score.total);
    expect(plan.requiredActions.length).toBeGreaterThan(0);
    expect(plan.supportingEvidence).toContain("Business");
  });
  it("is deterministic — same state + question picks the same strategy", () => {
    const a = planDecision(ctx(), evidence, routed, "where should I invest?");
    const b = planDecision(ctx(), evidence, routed, "where should I invest?");
    expect(a.recommendedStrategy.channel).toBe(b.recommendedStrategy.channel);
    expect(a.recommendedStrategy.score.total).toBe(b.recommendedStrategy.score.total);
  });
  it("surfaces missing information when there are no measured outcomes", () => {
    const plan = planDecision(ctx(), evidence, routed, "grow me");
    expect(plan.missingInformation.length).toBeGreaterThan(0);
    expect(plan.confidence).not.toBe("high");
  });
});

describe("planToArtifact", () => {
  it("projects a plan onto the renderer's DecisionArtifact shape", () => {
    const plan = planDecision(ctx(), evidence, routed, "advice?");
    const art = planToArtifact(plan, ctx());
    expect(art.status).toBe("recommended");
    expect(art.rankedOptions.length).toBeGreaterThanOrEqual(2);
    expect(art.recommendation).toMatch(/Prioritize/);
    expect(art.nextAction).toBeTruthy();
  });
  it("is insufficient_evidence for a cold workspace", () => {
    const cold = ctx({ channelRanking: [], missions: [], signals: { hasProfile: false, missionCount: 0, scoredOutcomes: 0, approvedActions: 0, dismissedActions: 0, hasLiveMetrics: false } });
    const plan = planDecision(cold, evidence, routed, "help");
    expect(planToArtifact(plan, cold).status).toBe("insufficient_evidence");
  });
});
