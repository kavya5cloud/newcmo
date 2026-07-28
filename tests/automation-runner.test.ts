import { describe, it, expect } from "vitest";
import { createAutomations, materialize, setState } from "@/lib/automation/engine";
import { preflight, retryFailed, runDue, extend, type PublishPort } from "@/lib/automation/runner";
import { InMemoryAutomationRepo } from "@/lib/automation/store";
import type { QueueItem } from "@/lib/automation/types";
import type { ConnectedAccount } from "@/lib/social/types";

// Executing automated slots. What matters is not that a happy path publishes — it is that
// the same slot can never publish twice, that a dead credential is not retried forever,
// and that a recurring schedule keeps going.

const MON = Date.UTC(2026, 0, 5);

const account = (over: Partial<ConnectedAccount> = {}): ConnectedAccount => ({
  id: "acc_1", tenant: "t", platform: "x", handle: "@populr",
  externalId: "x1", status: "connected", tokenExpiresAt: null,
  connectedAt: MON, ...over,
} as ConnectedAccount);

/** A stand-in for the M12 engine that records what it was asked to do. */
function fakeEngine(over: Partial<{ fail: boolean; throws: boolean; accounts: ConnectedAccount[] }> = {}) {
  const calls: string[] = [];
  const port: PublishPort = {
    async listAccounts() { return over.accounts ?? [account()]; },
    async publishNow(req) {
      if (over.throws) throw new Error("platform offline");
      calls.push(req.idempotencyKey);
      return over.fail
        ? { id: "job_1", state: "failed", error: "rate limited" }
        : { id: "job_" + calls.length, state: "published", error: null };
    },
  };
  return { port, calls };
}

const content = async () => ({ text: "hello world", assetIds: [] });

function dueQueue(now: number): QueueItem[] {
  const { automations } = createAutomations("t", "2 X posts daily", { release: "immediate", now });
  return materialize(automations, [], { from: now - 86_400_000, horizonDays: 1 })
    .map((q) => ({ ...q, at: now - 1000 }));
}

describe("preflight", () => {
  const slot = (over: Partial<QueueItem> = {}): QueueItem => ({
    id: "q1", tenant: "t", automationId: "a1", platform: "x", source: "ai_queue",
    at: MON, state: "upcoming", jobId: null, order: 0, note: null, ...over,
  });

  it("passes a connected account with a live token", () => {
    expect(preflight(slot(), [account()], { now: MON }).ok).toBe(true);
  });

  it("refuses when no account exists for the platform, and says where to fix it", () => {
    const r = preflight(slot({ platform: "linkedin" }), [account()], { now: MON });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failure.code).toBe("no_account");
    expect(!r.ok && r.failure.message).toContain("Cross-Post");
  });

  it("treats an expired token as unretryable — a credential cannot fix itself", () => {
    const r = preflight(slot(), [account({ tokenExpiresAt: MON - 1000 })], { now: MON });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failure.code).toBe("token_expired");
    expect(!r.ok && r.failure.retryable).toBe(false);
  });

  it("refuses a disconnected account", () => {
    const r = preflight(slot(), [account({ status: "disconnected" } as Partial<ConnectedAccount>)], { now: MON });
    expect(!r.ok && r.failure.code).toBe("disconnected");
  });

  it("blocks a media-required platform when the slot has none", () => {
    const r = preflight(slot({ platform: "instagram_business" }),
      [account({ platform: "instagram_business" })], { hasMedia: false, now: MON });
    expect(!r.ok && r.failure.code).toBe("media_required");
  });

  it("allows a media-required platform once media is attached", () => {
    expect(preflight(slot({ platform: "instagram_business" }),
      [account({ platform: "instagram_business" })], { hasMedia: true, now: MON }).ok).toBe(true);
  });
});

describe("running due slots", () => {
  it("publishes what is due and marks it published", async () => {
    const { port, calls } = fakeEngine();
    const q = dueQueue(MON);
    const r = await runDue(q, "t", { now: MON, engine: port, content });
    expect(r.outcomes.every((o) => o.ok)).toBe(true);
    expect(r.queue.every((s) => s.state === "published")).toBe(true);
    expect(calls).toHaveLength(q.length);
  });

  it("carries the slot id as the idempotency key the Publishing Engine dedupes on", async () => {
    const { port, calls } = fakeEngine();
    const q = dueQueue(MON);
    await runDue(q, "t", { now: MON, engine: port, content });
    expect(calls.every((k) => k.startsWith("automation:q_"))).toBe(true);
    expect(new Set(calls).size).toBe(calls.length);
  });

  it("a second run publishes nothing — the slots are no longer upcoming", async () => {
    const { port, calls } = fakeEngine();
    let q = dueQueue(MON);
    q = (await runDue(q, "t", { now: MON, engine: port, content })).queue;
    const before = calls.length;
    const again = await runDue(q, "t", { now: MON, engine: port, content });
    expect(again.outcomes).toHaveLength(0);
    expect(calls).toHaveLength(before);
  });

  it("does not touch a slot that is not yet due", async () => {
    const { port, calls } = fakeEngine();
    const { automations } = createAutomations("t", "2 X posts daily", { release: "immediate", now: MON });
    const q = materialize(automations, [], { from: MON + 86_400_000, horizonDays: 2 });
    const r = await runDue(q, "t", { now: MON, engine: port, content });
    expect(r.outcomes).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("never publishes a slot held for approval", async () => {
    const { port, calls } = fakeEngine();
    const { automations } = createAutomations("t", "2 X posts daily", { release: "after_approval", now: MON });
    const q = materialize(automations, [], { from: MON, horizonDays: 1 }).map((s) => ({ ...s, at: MON - 1000 }));
    await runDue(q, "t", { now: MON, engine: port, content });
    expect(calls).toHaveLength(0);
  });

  it("records a platform rejection as failed with the platform's reason", async () => {
    const { port } = fakeEngine({ fail: true });
    const r = await runDue(dueQueue(MON), "t", { now: MON, engine: port, content });
    expect(r.outcomes.every((o) => !o.ok)).toBe(true);
    expect(r.queue.every((s) => s.state === "failed")).toBe(true);
    expect(r.outcomes[0].message).toContain("rate limited");
  });

  it("a thrown engine fails the slot rather than losing it", async () => {
    const { port } = fakeEngine({ throws: true });
    const r = await runDue(dueQueue(MON), "t", { now: MON, engine: port, content });
    expect(r.queue.every((s) => s.state === "failed")).toBe(true);
    expect(r.outcomes[0].message).toContain("platform offline");
  });

  it("fails a slot with no content instead of posting filler", async () => {
    const { port, calls } = fakeEngine();
    const r = await runDue(dueQueue(MON), "t", { now: MON, engine: port, content: async () => null });
    expect(calls).toHaveLength(0);
    expect(r.outcomes[0].message).toContain("No content");
  });

  it("respects the per-run cap so one backlog cannot monopolise a minute", async () => {
    const { port, calls } = fakeEngine();
    const q = dueQueue(MON);
    await runDue(q, "t", { now: MON, engine: port, content, max: 1 });
    expect(calls).toHaveLength(1);
  });
});

describe("retries", () => {
  const failed = (at: number, note: string | null = null): QueueItem => ({
    id: "q1", tenant: "t", automationId: "a1", platform: "x", source: "ai_queue",
    at, state: "failed", jobId: null, order: 0, note,
  });

  it("waits out the backoff before retrying", () => {
    const q = [failed(MON)];
    expect(retryFailed(q, { now: MON + 30_000 }).retried).toHaveLength(0);   // 1m not elapsed
    expect(retryFailed(q, { now: MON + 61_000 }).retried).toHaveLength(1);
  });

  it("backs off exponentially between attempts", () => {
    const afterFirst = retryFailed([failed(MON)], { now: MON + 61_000 }).queue;
    expect(afterFirst[0].note).toBe("attempt 1");
    // Second attempt must wait 2m, not another 1m.
    expect(retryFailed(afterFirst.map((s) => ({ ...s, state: "failed" as const })), { now: MON + 90_000 }).retried).toHaveLength(0);
    expect(retryFailed(afterFirst.map((s) => ({ ...s, state: "failed" as const })), { now: MON + 121_000 }).retried).toHaveLength(1);
  });

  it("gives up after the attempt limit rather than retrying forever", () => {
    const q = [failed(MON, "attempt 3")];
    expect(retryFailed(q, { now: MON + 86_400_000 }).retried).toHaveLength(0);
    expect(q[0].state).toBe("failed");
  });

  it("a retried slot rejoins the normal publish path and succeeds", async () => {
    const { port, calls } = fakeEngine();
    const retried = retryFailed([failed(MON)], { now: MON + 61_000 }).queue;
    expect(retried[0].state).toBe("upcoming");
    const r = await runDue(retried, "t", { now: MON + 61_000, engine: port, content });
    expect(r.outcomes[0].ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("recurrence after a run", () => {
  it("extends the horizon so a schedule never runs dry", async () => {
    const { port } = fakeEngine();
    const { automations } = createAutomations("t", "2 X posts daily", { release: "immediate", now: MON });
    let q = materialize(automations, [], { from: MON, horizonDays: 2 });
    const initial = q.length;
    q = q.map((s) => ({ ...s, at: MON - 1000 }));
    q = (await runDue(q, "t", { now: MON, engine: port, content })).queue;
    const extended = extend(automations, q, MON + 86_400_000);
    expect(extended.length).toBeGreaterThan(initial);
  });

  it("extending never resurrects a published slot", async () => {
    const { port } = fakeEngine();
    const { automations } = createAutomations("t", "2 X posts daily", { release: "immediate", now: MON });
    let q = materialize(automations, [], { from: MON, horizonDays: 1 }).map((s) => ({ ...s, at: MON - 1000 }));
    q = (await runDue(q, "t", { now: MON, engine: port, content })).queue;
    const publishedIds = q.filter((s) => s.state === "published").map((s) => s.id);
    const extended = extend(automations, q, MON);
    for (const id of publishedIds) {
      expect(extended.find((s) => s.id === id)!.state).toBe("published");
    }
  });
});

describe("locking", () => {
  it("a claimed slot cannot be claimed again", () => {
    const q = dueQueue(MON);
    const first = setState(q, q[0].id, "publishing");
    expect(first.ok).toBe(true);
    expect(setState(first.queue, q[0].id, "publishing").ok).toBe(false);
  });
});

describe("store", () => {
  it("round-trips automations and queue, scoped per tenant", async () => {
    const repo = new InMemoryAutomationRepo();
    const { automations } = createAutomations("a", "2 X posts daily", { now: MON });
    for (const a of automations) await repo.saveAutomation(a);
    await repo.saveQueue(materialize(automations, [], { from: MON, horizonDays: 1 }));

    expect(await repo.listAutomations("a")).toHaveLength(1);
    expect(await repo.listAutomations("b")).toHaveLength(0);
    expect((await repo.listQueue("a")).length).toBeGreaterThan(0);
    expect(await repo.activeTenants()).toEqual(["a"]);
  });

  it("saving the same slot twice updates rather than duplicates", async () => {
    const repo = new InMemoryAutomationRepo();
    const { automations } = createAutomations("a", "2 X posts daily", { now: MON });
    const q = materialize(automations, [], { from: MON, horizonDays: 1 });
    await repo.saveQueue(q);
    await repo.saveQueue(q.map((s) => ({ ...s, state: "published" as const })));
    const stored = await repo.listQueue("a");
    expect(stored).toHaveLength(q.length);
    expect(stored.every((s) => s.state === "published")).toBe(true);
  });
});
