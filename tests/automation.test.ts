import { describe, it, expect } from "vitest";
import { parseAutomations, parseClause } from "@/lib/automation/parse";
import { expand, describe as describeCadence, parseSimpleRrule, startOfDay } from "@/lib/automation/recurrence";
import { createAutomations, materialize, setState, duplicate, due, summarize } from "@/lib/automation/engine";
import type { QueueItem } from "@/lib/automation/types";

// Automated publishing. The headline promise is that one sentence becomes a kept
// schedule, so these tests pin the parse, the expansion and the idempotence that stops
// an automation double-posting.

const SENTENCE = "Publish 3 LinkedIn posts every week, 2 X posts daily, and an Instagram carousel every Friday";
const MON = Date.UTC(2026, 0, 5);          // a Monday, for stable weekday maths

describe("parsing the instruction", () => {
  it("reads the headline sentence into three automations", () => {
    const { clauses, any } = parseAutomations(SENTENCE);
    expect(any).toBe(true);
    const ok = clauses.filter((c) => c.ok);
    expect(ok).toHaveLength(3);

    expect(ok[0]).toMatchObject({ platform: "linkedin", cadence: { kind: "weekly", count: 3 } });
    expect(ok[1]).toMatchObject({ platform: "x", cadence: { kind: "daily", count: 2 } });
    expect(ok[2]).toMatchObject({ platform: "instagram_business", cadence: { kind: "weekly", days: [5] } });
  });

  it("treats a named day as weekly even without the word week", () => {
    const c = parseClause("an Instagram carousel every Friday");
    expect(c.ok && c.cadence).toMatchObject({ kind: "weekly", days: [5] });
  });

  it("counts 'an' as one rather than defaulting to a burst", () => {
    const c = parseClause("an Instagram carousel every Friday");
    expect(c.ok && c.cadence.count).toBe(1);
  });

  it("reads number words as well as digits", () => {
    expect(parseClause("three LinkedIn posts weekly").ok && parseClause("three LinkedIn posts weekly")).toMatchObject({ cadence: { count: 3 } });
  });

  it("infers the content source from what was asked for", () => {
    expect(parseClause("an Instagram carousel every Friday")).toMatchObject({ source: "content_library" });
    expect(parseClause("a UGC testimonial on X weekly")).toMatchObject({ source: "ugc_library" });
    // Default is the AI queue — the point of automation is not hand-feeding it.
    expect(parseClause("2 LinkedIn posts daily")).toMatchObject({ source: "ai_queue" });
  });

  it("rejects a clause with no platform, and says what is missing", () => {
    const c = parseClause("3 posts every week");
    expect(c.ok).toBe(false);
    expect(!c.ok && c.reason).toContain("No platform named");
  });

  it("rejects a clause with no cadence, and says what is missing", () => {
    const c = parseClause("some LinkedIn posts");
    expect(c.ok).toBe(false);
    expect(!c.ok && c.reason).toContain("No cadence");
  });

  it("keeps the good clauses when one is unparseable", () => {
    const { clauses } = parseAutomations("3 LinkedIn posts weekly, and some vibes");
    expect(clauses.filter((c) => c.ok)).toHaveLength(1);
    expect(clauses.filter((c) => !c.ok)).toHaveLength(1);
  });
});

describe("recurrence", () => {
  it("expands a daily cadence to the requested count per day", () => {
    const slots = expand({ kind: "daily", count: 2, days: [] }, { from: MON, to: MON + 3 * 86_400_000 });
    expect(slots).toHaveLength(6);
    expect(new Set(slots).size).toBe(6);          // never two posts at the same instant
  });

  it("puts a named-day weekly cadence only on that day", () => {
    const slots = expand({ kind: "weekly", count: 1, days: [5] }, { from: MON, to: MON + 21 * 86_400_000 });
    expect(slots).toHaveLength(3);
    for (const s of slots) expect(new Date(s).getUTCDay()).toBe(5);
  });

  it("spreads an unnamed weekly cadence instead of bursting on consecutive days", () => {
    const slots = expand({ kind: "weekly", count: 3, days: [] }, { from: MON, to: MON + 7 * 86_400_000 });
    expect(slots).toHaveLength(3);
    const days = slots.map((s) => new Date(s).getUTCDay());
    expect(new Set(days).size).toBe(3);
  });

  it("is deterministic — the same window always yields the same slots", () => {
    const a = expand({ kind: "weekly", count: 3, days: [] }, { from: MON, to: MON + 14 * 86_400_000 });
    const b = expand({ kind: "weekly", count: 3, days: [] }, { from: MON, to: MON + 14 * 86_400_000 });
    expect(a).toEqual(b);
  });

  it("returns sorted slots inside the window and nothing outside it", () => {
    const from = MON, to = MON + 5 * 86_400_000;
    const slots = expand({ kind: "daily", count: 1, days: [] }, { from, to });
    expect(slots).toEqual([...slots].sort((x, y) => x - y));
    expect(slots.every((s) => s >= from && s < to)).toBe(true);
  });

  it("honours the RRULE subset it supports and refuses the rest", () => {
    expect(parseSimpleRrule("RRULE:FREQ=WEEKLY;BYDAY=MO,WE")).toMatchObject({ kind: "weekly", days: [1, 3] });
    expect(parseSimpleRrule("RRULE:FREQ=DAILY;COUNT=2")).toMatchObject({ kind: "daily", count: 2 });
    // A half-understood rule publishes on days nobody asked for, so it is refused.
    expect(parseSimpleRrule("RRULE:FREQ=WEEKLY;INTERVAL=3")).toBeNull();
    expect(parseSimpleRrule("RRULE:FREQ=HOURLY")).toBeNull();
    expect(parseSimpleRrule("nonsense")).toBeNull();
  });

  it("produces no slots for an unsupported custom rule rather than guessing", () => {
    const slots = expand({ kind: "custom", count: 1, days: [], rrule: "RRULE:FREQ=HOURLY" }, { from: MON, to: MON + 86_400_000 });
    expect(slots).toHaveLength(0);
  });

  it("describes a cadence back in words", () => {
    expect(describeCadence({ kind: "weekly", count: 3, days: [] })).toBe("3 posts a week");
    expect(describeCadence({ kind: "weekly", count: 1, days: [5] })).toContain("Fri");
    expect(describeCadence({ kind: "daily", count: 2, days: [] })).toBe("2 posts a day");
  });

  it("startOfDay lands on midnight UTC", () => {
    expect(new Date(startOfDay(MON + 3600_000 * 17)).getUTCHours()).toBe(0);
  });
});

describe("the engine", () => {
  it("turns the headline sentence into three live automations", () => {
    const { automations, rejected } = createAutomations("t", SENTENCE, { now: MON });
    expect(automations).toHaveLength(3);
    expect(rejected).toHaveLength(0);
    expect(automations.every((a) => a.active)).toBe(true);
  });

  it("surfaces rejected clauses instead of dropping them", () => {
    const { automations, rejected } = createAutomations("t", "3 LinkedIn posts weekly, and some vibes", { now: MON });
    expect(automations).toHaveLength(1);
    expect(rejected[0].reason).toBeTruthy();
  });

  it("materialising twice adds nothing the second time", () => {
    const { automations } = createAutomations("t", SENTENCE, { now: MON });
    const first = materialize(automations, [], { from: MON, horizonDays: 14 });
    const second = materialize(automations, first, { from: MON, horizonDays: 14 });
    expect(second).toHaveLength(first.length);
    expect(first.length).toBeGreaterThan(0);
  });

  it("never regenerates a slot that already published", () => {
    const { automations } = createAutomations("t", "2 X posts daily", { now: MON });
    let queue = materialize(automations, [], { from: MON, horizonDays: 3 });
    queue = queue.map((q, i) => (i === 0 ? { ...q, state: "published" as const } : q));
    const again = materialize(automations, queue, { from: MON, horizonDays: 3 });
    expect(again.filter((q) => q.state === "published")).toHaveLength(1);
    expect(again).toHaveLength(queue.length);
  });

  it("holds slots for approval when that is the release mode", () => {
    const { automations } = createAutomations("t", "2 X posts daily", { release: "after_approval", now: MON });
    const queue = materialize(automations, [], { from: MON, horizonDays: 2 });
    expect(queue.every((q) => q.state === "waiting_approval")).toBe(true);
  });

  it("skips paused automations without disturbing their history", () => {
    const { automations } = createAutomations("t", "2 X posts daily", { now: MON });
    const queue = materialize(automations, [], { from: MON, horizonDays: 2 });
    const paused = automations.map((a) => ({ ...a, active: false }));
    const after = materialize(paused, queue, { from: MON, horizonDays: 4 });
    expect(after).toHaveLength(queue.length);
  });

  it("refuses illegal state changes — a published post cannot be un-published", () => {
    const item: QueueItem = {
      id: "q1", tenant: "t", automationId: "a1", platform: "x", source: "ai_queue",
      at: MON, state: "published", jobId: null, order: 0, note: null,
    };
    const r = setState([item], "q1", "upcoming");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("cannot become");
  });

  it("allows the real recovery path: failed → retrying → publishing", () => {
    const item: QueueItem = {
      id: "q1", tenant: "t", automationId: "a1", platform: "x", source: "ai_queue",
      at: MON, state: "failed", jobId: null, order: 0, note: null,
    };
    const a = setState([item], "q1", "retrying");
    expect(a.ok).toBe(true);
    expect(setState(a.queue, "q1", "publishing").ok).toBe(true);
  });

  it("duplicating offsets the copy so it cannot collide with the original", () => {
    const { automations } = createAutomations("t", "2 X posts daily", { now: MON });
    const queue = materialize(automations, [], { from: MON, horizonDays: 1 });
    const dup = duplicate(queue, queue[0].id);
    expect(dup).toHaveLength(queue.length + 1);
    expect(new Set(dup.map((q) => q.id)).size).toBe(dup.length);
    expect(new Set(dup.map((q) => q.at)).size).toBe(dup.length);
  });

  it("only reports upcoming slots that are actually due", () => {
    const { automations } = createAutomations("t", "2 X posts daily", { now: MON });
    const queue = materialize(automations, [], { from: MON, horizonDays: 3 });
    const ready = due(queue, MON + 86_400_000);
    expect(ready.every((q) => q.at <= MON + 86_400_000 && q.state === "upcoming")).toBe(true);
    expect(ready.length).toBeLessThan(queue.length);
  });

  it("summaries agree with the queue they came from", () => {
    const { automations } = createAutomations("t", SENTENCE, { now: MON });
    const queue = materialize(automations, [], { from: MON, horizonDays: 14 });
    for (const s of summarize(automations, queue)) {
      const mine = queue.filter((q) => q.automationId === s.automationId);
      expect(s.upcoming).toBe(mine.filter((q) => q.state === "upcoming" || q.state === "waiting_approval").length);
      expect(s.cadenceLabel.length).toBeGreaterThan(0);
      if (s.nextAt) expect(mine.some((q) => q.at === s.nextAt)).toBe(true);
    }
  });
});
