import { describe, expect, it } from "vitest";
import { ANGLES, angleFor, angleKeyFor, dayIndex, formFor, formKeyFor, topicForSlot } from "@/lib/automation/topic";
import type { QueueItem } from "@/lib/automation/types";
import type { SocialPlatform } from "@/lib/social/types";

// The bug these exist for: the prompt used to be derived by deleting numbers and cadence
// words from the automation's statement, so "3 LinkedIn posts every week" became the prompt
// "LinkedIn   week" — asked identically, every day, forever. Same input, same output, same
// post. These tests assert the two properties that fix requires.

const DAY = 86_400_000;
const slot = (at: number, platform: SocialPlatform = "linkedin"): QueueItem => ({
  id: "q", tenant: "t", automationId: "a", platform, source: "ai_queue",
  at, state: "upcoming", jobId: null, order: 0, note: null,
});

describe("every calendar day gets a different angle", () => {
  const start = Date.UTC(2026, 0, 1, 9, 0);

  it("does not repeat within a full rotation", () => {
    const keys = Array.from({ length: ANGLES.length }, (_, i) => angleFor(start + i * DAY, "linkedin").key);
    expect(new Set(keys).size).toBe(ANGLES.length);
  });

  it("changes from one day to the next, across a fortnight", () => {
    for (let i = 0; i < 14; i++) {
      const today = angleFor(start + i * DAY, "linkedin").key;
      const tomorrow = angleFor(start + (i + 1) * DAY, "linkedin").key;
      expect(today, `day ${i} and ${i + 1} asked for the same thing`).not.toBe(tomorrow);
    }
  });

  it("gives the same day the same angle however often it is asked", () => {
    // Slots are idempotent; re-running a day must not invent a different post.
    const morning = angleFor(start, "linkedin").key;
    const evening = angleFor(start + 8 * 3_600_000, "linkedin").key;
    expect(evening).toBe(morning);
  });

  it("treats a calendar day as a whole day, not a rolling 24 hours", () => {
    expect(dayIndex(Date.UTC(2026, 0, 1, 0, 1))).toBe(dayIndex(Date.UTC(2026, 0, 1, 23, 59)));
    expect(dayIndex(Date.UTC(2026, 0, 2, 0, 1))).not.toBe(dayIndex(Date.UTC(2026, 0, 1, 23, 59)));
  });

  it("staggers platforms so two posts the same morning do not say the same thing", () => {
    // Posting the identical thought to LinkedIn and X within a minute reads worse than
    // posting nothing at all.
    const li = angleFor(start, "linkedin").key;
    const x = angleFor(start, "x").key;
    expect(x).not.toBe(li);
  });
});

describe("the goal shapes the angles without collapsing them", () => {
  const start = Date.UTC(2026, 3, 7, 9, 0);

  it("still varies day to day inside a goal", () => {
    for (const goal of ["customers", "traffic", "brand", "launch", "active"] as const) {
      const keys = Array.from({ length: 4 }, (_, i) => angleFor(start + i * DAY, "linkedin", goal).key);
      expect(new Set(keys).size, `${goal} repeated inside four days`).toBeGreaterThan(1);
    }
  });

  it("leans a launch towards shipping and results", () => {
    const keys = new Set(Array.from({ length: 8 }, (_, i) => angleFor(start + i * DAY, "linkedin", "launch").key));
    expect([...keys].every((k) => ["shipped", "result", "behind", "howto"].includes(k))).toBe(true);
  });

  it("uses every angle when the goal is simply to stay active", () => {
    const keys = new Set(Array.from({ length: ANGLES.length }, (_, i) => angleFor(start + i * DAY, "linkedin", "active").key));
    expect(keys.size).toBe(ANGLES.length);
  });
});

describe("the brief itself", () => {
  const at = Date.UTC(2026, 5, 10, 9, 0);

  it("asks for something specific rather than 'a post'", () => {
    const t = topicForSlot(slot(at), { goal: "customers" });
    expect(t.length).toBeGreaterThan(30);
    // The old prompt was literally the platform name and a stray cadence word.
    expect(t).not.toMatch(/^LinkedIn\s+week$/);
    expect(t).not.toMatch(/^\s*$/);
  });

  it("names the business and who it is for when they are known", () => {
    const t = topicForSlot(slot(at), { product: "Acme", oneLiner: "invoicing that chases payment", audience: "freelancers" });
    expect(t).toContain("Acme");
    expect(t).toContain("invoicing that chases payment");
    expect(t).toContain("freelancers");
  });

  it("reads sensibly when nothing about the business is known", () => {
    const t = topicForSlot(slot(at));
    expect(t).toContain("the people you sell to");
    expect(t).not.toContain("undefined");
    expect(t).not.toContain("null");
  });

  it("tells the writer which openings not to reuse", () => {
    const t = topicForSlot(slot(at), {
      recent: ["Most founders think pricing is a maths problem. It is not.", "We shipped a thing today and here is why"],
    });
    expect(t).toContain("Do not open the way any of these did");
    expect(t).toContain("Most founders think pricing is a");
  });

  it("says nothing about repetition when there is no history", () => {
    expect(topicForSlot(slot(at), { recent: [] })).not.toContain("Do not open");
  });

  it("produces a different brief on consecutive days", () => {
    // The property the whole change exists for.
    const a = topicForSlot(slot(at), { goal: "customers" });
    const b = topicForSlot(slot(at + DAY), { goal: "customers" });
    expect(a).not.toBe(b);
  });

  it("exposes the angle for the record", () => {
    expect(angleKeyFor(slot(at), "launch")).toBe(angleFor(at, "linkedin", "launch").key);
  });
});

// Angle alone cycles every seven days, so the second Monday asked for exactly what the
// first Monday asked for — a real repeat, on the cadence a weekly poster would notice
// first. Pairing it with a form on a six-day cycle is what these pin.
describe("the brief does not come round again for six weeks", () => {
  const start = Date.UTC(2026, 0, 1, 9, 0);
  const briefKey = (at: number, p: SocialPlatform = "linkedin") =>
    `${angleKeyFor(slot(at, p))}/${formKeyFor(slot(at, p))}`;

  it("repeated the whole brief every 7 days when the angle was all there was", () => {
    // The old behaviour, still true of the angle on its own — this is what was wrong.
    expect(angleFor(start, "linkedin").key).toBe(angleFor(start + 7 * DAY, "linkedin").key);
  });

  it("no longer repeats at 7 days, or at any point inside six weeks", () => {
    const keys = Array.from({ length: 42 }, (_, i) => briefKey(start + i * DAY));
    expect(new Set(keys).size).toBe(42);
  });

  it("comes round only at 42, which is where a rotation honestly ends", () => {
    expect(briefKey(start)).toBe(briefKey(start + 42 * DAY));
  });

  it("does not hand two platforms the same brief on the same morning", () => {
    for (let i = 0; i < 14; i++) {
      const at = start + i * DAY;
      expect(briefKey(at, "linkedin"), `day ${i}`).not.toBe(briefKey(at, "x"));
    }
  });

  it("says who the business is, and asks for a shape", () => {
    const brief = topicForSlot(slot(start), {
      product: "Populr", oneLiner: "an AI CMO that reasons", audience: "seed-stage founders",
    });
    // The gap this closes: the brief used to name nobody, for every workspace alike.
    expect(brief).toContain("Populr");
    expect(brief).toContain("an AI CMO that reasons");
    expect(brief).toContain("seed-stage founders");
    expect(brief).not.toContain("the people you sell to");
    // And it must ask for a form, or the shape rotation reaches nothing.
    expect(brief).toContain(formFor(start, "linkedin").ask);
  });

  it("still reads sensibly for a workspace that has never been analysed", () => {
    const brief = topicForSlot(slot(start));
    expect(brief).toContain("the people you sell to");
    expect(brief.length).toBeGreaterThan(40);
  });
});
