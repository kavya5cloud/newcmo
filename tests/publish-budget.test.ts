import { describe, expect, it } from "vitest";
import { reclaimStalled, retryFailed, runDue, STALE_CLAIM_MS, type PublishPort } from "@/lib/automation/runner";
import { setState } from "@/lib/automation/engine";
import type { QueueItem } from "@/lib/automation/types";

// The publish pass 504'd. The loud half was the timeout; the quiet half was worse — a slot
// claimed as `publishing` when the function is killed transitions nowhere, and retryFailed
// only ever looked at `failed`. Every timeout permanently retired whatever was in flight.

const NOW = 1_000_000_000;
const slot = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: "q1", tenant: "t", automationId: "a1", platform: "linkedin", source: "ai_queue",
  at: NOW - 60_000, state: "upcoming", jobId: null, order: 0, note: null, ...over,
});

describe("a claim expires", () => {
  it("returns a stranded slot to the retry path", () => {
    const stuck = slot({ state: "publishing", claimedAt: NOW - STALE_CLAIM_MS - 1 });
    const { queue, reclaimed } = reclaimStalled([stuck], { now: NOW });
    expect(reclaimed).toEqual(["q1"]);
    expect(queue[0].state).toBe("failed");
    expect(queue[0].claimedAt).toBeNull();
    // Routed through `failed` so the existing backoff and attempt cap apply, rather than a
    // second recovery path that drifts out of step with the first.
    const after = retryFailed(queue, { now: NOW + 10 * 60_000 });
    expect(after.queue[0].state).toBe("upcoming");
  });

  it("leaves a claim that is still plausibly running alone", () => {
    const live = slot({ state: "publishing", claimedAt: NOW - 30_000 });
    expect(reclaimStalled([live], { now: NOW }).reclaimed).toEqual([]);
  });

  it("treats a claim written before the field existed as stale", () => {
    // Leaving these stuck forever is the bug; one extra attempt is the cost of guessing.
    const legacy = slot({ state: "publishing" });
    expect(reclaimStalled([legacy], { now: NOW }).reclaimed).toEqual(["q1"]);
  });

  it("ignores slots that were never claimed", () => {
    for (const state of ["upcoming", "published", "failed", "cancelled"] as const) {
      expect(reclaimStalled([slot({ state })], { now: NOW }).reclaimed, state).toEqual([]);
    }
  });
});

describe("claiming stamps the time, releasing clears it", () => {
  it("records when the claim was taken", () => {
    const r = setState([slot()], "q1", "publishing");
    expect(r.ok).toBe(true);
    expect(typeof r.queue[0].claimedAt).toBe("number");
  });

  it("clears the stamp on the way out, so it describes the claim held now", () => {
    const claimed = setState([slot()], "q1", "publishing").queue;
    const done = setState(claimed, "q1", "published").queue;
    expect(done[0].claimedAt).toBeNull();
  });
});

describe("the pass yields rather than being killed", () => {
  const port = (): PublishPort => ({
    listAccounts: async () => [],
    schedule: async () => ({ id: "j", state: "scheduled" }),
  } as unknown as PublishPort);

  it("stops starting slots once the budget is spent", async () => {
    // Twenty-five due slots, each needing generation, do not fit in a 60s function. Being
    // terminated mid-loop is what stranded claims in the first place.
    const queue = Array.from({ length: 25 }, (_, i) => slot({ id: `q${i}`, at: NOW - 1000 }));
    const r = await runDue(queue, "t", { now: NOW, engine: port(), budgetMs: 0 });
    // Budget zero: the first check trips before anything is claimed.
    expect(r.outcomes.length).toBe(0);
    expect(r.queue.every((q) => q.state === "upcoming")).toBe(true);
  });

  it("leaves unstarted slots upcoming so the next pass takes them", async () => {
    const queue = Array.from({ length: 5 }, (_, i) => slot({ id: `q${i}`, at: NOW - 1000 }));
    const r = await runDue(queue, "t", { now: NOW, engine: port(), budgetMs: 0 });
    expect(r.queue.filter((q) => q.state === "upcoming")).toHaveLength(5);
  });
});
