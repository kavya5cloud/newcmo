import { describe, it, expect } from "vitest";
import { PublishingEngine } from "@/lib/publishing/engine";
import type { PublishSlot } from "@/lib/launch/types";
import type { LaunchDependencyGraph } from "@/lib/launch/types";

const slots: PublishSlot[] = [
  { assetKey: "c1:hero_video", kind: "hero_video", channel: "video", week: 1, dayOffset: 0, stage: "draft" },
  { assetKey: "c1:linkedin_post", kind: "linkedin_post", channel: "linkedin", week: 2, dayOffset: 7, stage: "draft" },
];

// Minimal dependency graph: hero_video → linkedin_post.
const graph: LaunchDependencyGraph = {
  nodes: [
    { key: "c1:hero_video", kind: "hero_video", label: "Hero", campaignId: "c1", dependsOn: [], dependents: ["c1:linkedin_post"], depth: 0 },
    { key: "c1:linkedin_post", kind: "linkedin_post", label: "LI", campaignId: "c1", dependsOn: ["c1:hero_video"], dependents: [], depth: 1 },
  ],
  byKey: {} as never,
  edges: [{ from: "c1:hero_video", to: "c1:linkedin_post" }],
  roots: ["c1:hero_video"],
};
graph.byKey = Object.fromEntries(graph.nodes.map((n) => [n.key, n])) as never;

function advanceTo(e: PublishingEngine, key: string, stage: string) {
  for (let i = 0; i < 10 && e.get(key)!.stage !== stage; i++) {
    if (e.get(key)!.stage === "approval") { e.approve(key); continue; }
    if (!e.advance(key).ok) break;
  }
}

describe("Publishing Engine (event-driven lifecycle)", () => {
  it("moves an asset through the full lifecycle to published", () => {
    const e = new PublishingEngine();
    e.load(slots);
    advanceTo(e, "c1:hero_video", "published");
    expect(e.get("c1:hero_video")!.stage).toBe("published");
    // events were emitted along the way
    const types = e.bus.events("c1:hero_video").map((x) => x.type);
    expect(types).toContain("asset.published");
    expect(types).toContain("asset.scheduled");
  });

  it("enforces the approval gate (cannot reach scheduled without approval)", () => {
    const e = new PublishingEngine();
    e.load(slots);
    e.advance("c1:hero_video"); // draft → creative_review
    e.advance("c1:hero_video"); // creative_review → approval
    const blocked = e.advance("c1:hero_video"); // approval → scheduled BLOCKED
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toBe("approval_required");
    const ok = e.approve("c1:hero_video"); // now allowed
    expect(ok.ok).toBe(true);
    expect(e.get("c1:hero_video")!.stage).toBe("scheduled");
  });

  it("flags dependents as needs-review when an upstream asset changes", () => {
    const e = new PublishingEngine({ dependencyGraph: graph });
    e.load(slots);
    // advance linkedin partway
    e.advance("c1:linkedin_post");
    const flagged = e.markUpstreamChanged("c1:hero_video");
    expect(flagged).toContain("c1:linkedin_post");
    expect(e.needsReviewKeys()).toContain("c1:linkedin_post");
    expect(e.bus.events("c1:linkedin_post").some((x) => x.type === "asset.needs_review")).toBe(true);
  });

  it("supports retry after a failed publish and rollback", () => {
    const e = new PublishingEngine();
    e.add("x", "scheduled");
    const fail = e.advance("x", { shouldFail: true }); // scheduled → publishing fails
    expect(fail.ok).toBe(false);
    expect(e.get("x")!.failed).toBe(true);
    const retry = e.retry("x"); // succeeds
    expect(retry.ok).toBe(true);
    expect(e.get("x")!.stage).toBe("publishing");
    const rb = e.rollback("x");
    expect(rb.ok).toBe(true);
    expect(e.get("x")!.stage).toBe("scheduled");
  });

  it("bulk-advances many assets and summarizes stages", () => {
    const e = new PublishingEngine();
    e.load(slots);
    const results = e.bulkAdvance(["c1:hero_video", "c1:linkedin_post"]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(e.summary().creative_review).toBe(2);
  });
});
