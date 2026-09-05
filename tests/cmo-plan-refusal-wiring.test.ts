import { beforeEach, describe, expect, it } from "vitest";
import { generateCandidates } from "@/lib/cmo/planner";
import { refusalsFromPlan } from "@/lib/refusals/from-plan";
import { refusalRepo, resetRefusalRepoForTests } from "@/lib/refusals/store";
import type { CmoContext } from "@/lib/services/cmo-context";

// This is the sequence app/api/cmo/plan/route.ts now runs after planDecision(): recompute
// the full candidate list, derive refusals, persist them. Before this wiring existed,
// refusalsFromPlan's output was never written anywhere — this locks in that the sequence
// actually results in persisted, retrievable refusal records.

function ctx(overrides: Partial<CmoContext> = {}): CmoContext {
  return {
    business: { name: "Populr", oneLiner: "AI CMO", audience: "founders", competitors: ["okara"], url: "https://x.test" },
    missions: [],
    channelRanking: [
      { channel: "seo", score: 0.62, yours: null },
      { channel: "reddit", score: 0.55, yours: { generated: 4, approved: 2 } },
      { channel: "linkedin", score: 0.48, yours: null },
      { channel: "x", score: 0.46, yours: null },
      { channel: "hn", score: 0.3, yours: null },
    ],
    whatWorked: [],
    dismissed: [],
    latestMetrics: null,
    recentAssets: [],
    signals: { hasProfile: true, missionCount: 0, scoredOutcomes: 0, approvedActions: 2, dismissedActions: 0, hasLiveMetrics: false },
    ...overrides,
  };
}

beforeEach(() => resetRefusalRepoForTests());

describe("recording refusals from a planning pass", () => {
  it("persists the dropped candidates so they're retrievable afterward", async () => {
    const workspace = "ws_test_1";
    const candidates = generateCandidates(ctx());
    const refusals = refusalsFromPlan(candidates, workspace, Date.now());

    expect(refusals.length).toBeGreaterThan(0);

    for (const r of refusals) {
      await refusalRepo().record(r);
    }

    const stored = await refusalRepo().list(workspace);
    expect(stored).toHaveLength(refusals.length);
    expect(stored.map((s) => s.channel).sort()).toEqual(refusals.map((r) => r.channel).sort());
  });

  it("stores nothing when the plan had no real choice to make", async () => {
    const workspace = "ws_test_2";
    const smallCtx = ctx({
      channelRanking: [
        { channel: "seo", score: 0.62, yours: null },
        { channel: "reddit", score: 0.55, yours: null },
      ],
    });
    const candidates = generateCandidates(smallCtx);
    const refusals = refusalsFromPlan(candidates, workspace, Date.now());
    expect(refusals).toEqual([]);

    for (const r of refusals) {
      await refusalRepo().record(r);
    }
    expect(await refusalRepo().list(workspace)).toHaveLength(0);
  });
});