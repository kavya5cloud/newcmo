import { beforeEach, describe, expect, it } from "vitest";
import { refusalRepo, resetRefusalRepoForTests } from "@/lib/refusals/store";
import { scoreRefusals, REASON_LABEL, REFUSAL_REASONS, type Refusal } from "@/lib/refusals/types";

// The ledger is the one claim in this category that cannot be asserted — making it requires
// having declined things and then having been checked. Which means the failure mode is not a
// crash, it is a scorecard that flatters itself. Most of these guard that.

const base = {
  workspaceKey: "ws1",
  proposed: 'Write 4 articles for "best crm"',
  channel: "seo",
  reason: "unwinnable_search" as const,
  explanation: "Three incumbents own page one and have for two years.",
  insteadDid: "Fixed the pricing page",
  checkableAt: null,
};

beforeEach(() => resetRefusalRepoForTests());

describe("recording a refusal", () => {
  it("stores what was proposed, why, and what happened instead", async () => {
    const r = await refusalRepo().record(base);
    expect(r.proposed).toBe(base.proposed);
    expect(r.explanation).toBe(base.explanation);
    expect(r.insteadDid).toBe("Fixed the pricing page");
  });

  it("starts with no verdict and no evidence", async () => {
    // A refusal is not right because we made it. It is right when something says so.
    const r = await refusalRepo().record(base);
    expect(r.verdict).toBe("unknown");
    expect(r.evidence).toBeNull();
    expect(r.resolvedAt).toBeNull();
  });

  it("keeps refusals per workspace", async () => {
    const repo = refusalRepo();
    await repo.record(base);
    await repo.record({ ...base, workspaceKey: "ws2" });
    expect(await repo.list("ws1")).toHaveLength(1);
    expect(await repo.list("ws2")).toHaveLength(1);
  });
});

describe("grading only what is checkable", () => {
  it("does not offer a refusal for grading before its date", async () => {
    const repo = refusalRepo();
    const later = Date.now() + 30 * 86_400_000;
    await repo.record({ ...base, checkableAt: later });
    expect(await repo.due("ws1", Date.now())).toHaveLength(0);
  });

  it("offers it once the date has passed", async () => {
    const repo = refusalRepo();
    await repo.record({ ...base, checkableAt: Date.now() - 1000 });
    expect(await repo.due("ws1", Date.now())).toHaveLength(1);
  });

  it("never offers one that has no checkable date", async () => {
    // "Won't rank" with no horizon is a judgement nothing will ever settle. It stays unknown
    // rather than being graded on a guess.
    const repo = refusalRepo();
    await repo.record({ ...base, checkableAt: null });
    expect(await repo.due("ws1", Date.now() + 1e12)).toHaveLength(0);
  });

  it("stops offering it after a verdict is written", async () => {
    const repo = refusalRepo();
    const r = await repo.record({ ...base, checkableAt: Date.now() - 1000 });
    await repo.resolve(r.id, "held", "Still nothing from those three sites on page one.", Date.now());
    expect(await repo.due("ws1", Date.now())).toHaveLength(0);
  });
});

describe("the scorecard cannot flatter itself", () => {
  const at = (over: Partial<Refusal>): Refusal => ({
    id: "x", workspaceKey: "ws1", proposed: "p", channel: "seo", reason: "low_intent",
    explanation: "e", insteadDid: null, checkableAt: null, verdict: "unknown",
    evidence: null, createdAt: 0, resolvedAt: null, ...over,
  });

  it("reports accuracy as null when nothing has been decided", () => {
    // Zero would read as "wrong every time". Null reads as "not checked yet", which is what
    // is true for a new account — and is the number that would otherwise be quietly rounded
    // into a claim.
    const s = scoreRefusals([at({}), at({})], 0);
    expect(s.accuracy).toBeNull();
    expect(s.total).toBe(2);
  });

  it("counts held against wrong, and nothing else", () => {
    const s = scoreRefusals([
      at({ verdict: "held" }), at({ verdict: "held" }), at({ verdict: "wrong" }),
      at({ checkableAt: 10_000 }),   // pending
      at({}),                         // unknown
    ], 0);
    expect(s.accuracy).toBeCloseTo(2 / 3);
    expect(s.pending).toBe(1);
    expect(s.unknown).toBe(1);
  });

  it("separates pending from unknown rather than merging them", () => {
    // Merging them lets "not yet checkable" hide inside "checked and inconclusive", which is
    // how an unproven record starts looking like an ambiguous one.
    const now = 5_000;
    const s = scoreRefusals([at({ checkableAt: 9_000 }), at({ checkableAt: 1_000 })], now);
    expect(s.pending).toBe(1);
    expect(s.unknown).toBe(1);
  });

  it("gives every reason a label, so none renders as a raw enum", () => {
    for (const r of REFUSAL_REASONS) {
      expect(REASON_LABEL[r], `${r} has no label`).toBeTruthy();
    }
  });
});
