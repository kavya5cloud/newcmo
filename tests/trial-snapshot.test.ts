import { describe, expect, it } from "vitest";
import { trialSnapshot, DAY_MS } from "@/app/app/_lib/trial";

// The dashboard's full-screen "Your free month has ended" lock renders from this. It used
// to recompute `active` as `now < endsAt`, replacing the server's verdict with a date
// comparison — and the server's is the only one that knows about subscriptions, the grace
// period after a failed payment, and a cancelled plan paid through to a date.

const NOW = Date.parse("2026-08-22T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("the browser counts down; the server decides", () => {
  it("never locks out an account the server allowed, whatever the date says", () => {
    // An active subscription whose current_period_end is null: /api/auth/me falls back to
    // the local trial date, which for any customer past their first month is in the past.
    const past = trialSnapshot({ active: true, daysLeft: 0, endsAt: iso(NOW - 10 * DAY_MS) }, NOW);
    expect(past!.active).toBe(true);
  });

  it("never lets through an account the server refused", () => {
    // The mirror image: a failed payment out of grace, with a local trial date still ahead.
    const future = trialSnapshot({ active: false, daysLeft: 9, endsAt: iso(NOW + 9 * DAY_MS) }, NOW);
    expect(future!.active).toBe(false);
  });

  it("still ticks the countdown down as the day passes", () => {
    const endsAt = iso(NOW + 3 * DAY_MS);
    expect(trialSnapshot({ active: true, daysLeft: 30, endsAt }, NOW)!.daysLeft).toBe(3);
    expect(trialSnapshot({ active: true, daysLeft: 30, endsAt }, NOW + 2 * DAY_MS)!.daysLeft).toBe(1);
  });

  it("never shows a negative countdown", () => {
    const s = trialSnapshot({ active: true, daysLeft: 1, endsAt: iso(NOW - 5 * DAY_MS) }, NOW);
    expect(s!.daysLeft).toBe(0);
  });

  it("passes an unparseable date through rather than guessing", () => {
    const t = { active: true, daysLeft: 7, endsAt: "not a date" };
    expect(trialSnapshot(t, NOW)).toEqual(t);
  });

  it("has nothing to say when the server sent no trial", () => {
    expect(trialSnapshot(null, NOW)).toBeNull();
  });
});
