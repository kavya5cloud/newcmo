import { describe, expect, it } from "vitest";
import { tomorrowWindow, tomorrowHeadline, type Tomorrow } from "@/lib/tomorrow/assemble";

// The screen that replaces four control panels. Everything on it was decided elsewhere;
// what is tested here is that it reads the right day and never overstates what will happen.

const base: Tomorrow = {
  from: 0, to: 0, posts: [], skipped: [], idleReason: null, awaiting: 0,
};
const post = (over: Partial<Tomorrow["posts"][number]> = {}): Tomorrow["posts"][number] => ({
  id: "q1", at: 0, platform: "linkedin", platformLabel: "LinkedIn",
  angle: "a lesson learned the hard way", form: "Tell it as one short story.",
  needsApproval: false, willActuallyPublish: true, ...over,
});

describe("tomorrow means the founder's tomorrow", () => {
  const DAY = 86_400_000;

  it("is the next calendar day, not now plus 24 hours", () => {
    const at = Date.UTC(2026, 7, 21, 9, 30);
    const { from, to } = tomorrowWindow(at, 0);
    expect(new Date(from).toISOString()).toBe("2026-08-22T00:00:00.000Z");
    expect(to - from).toBe(DAY);
  });

  it("rolls over in the viewer's timezone, not in Greenwich", () => {
    // 23:00 in Bengaluru (UTC+5:30) on the 21st is 17:30 UTC on the 21st. Their tomorrow is
    // the 22nd local — a UTC-only window would call it the 22nd too here, so use a case that
    // actually separates them: 01:00 local on the 22nd is 19:30 UTC on the 21st.
    const at = Date.UTC(2026, 7, 21, 19, 30);
    const utc = tomorrowWindow(at, 0);
    const ist = tomorrowWindow(at, 330);
    expect(new Date(utc.from).toISOString()).toBe("2026-08-22T00:00:00.000Z");
    // In IST it is already the 22nd, so tomorrow is the 23rd local = 18:30 UTC on the 22nd.
    expect(new Date(ist.from).toISOString()).toBe("2026-08-22T18:30:00.000Z");
    expect(ist.from).not.toBe(utc.from);
  });
});

describe("the headline never overstates the day", () => {
  it("names one platform plainly", () => {
    expect(tomorrowHeadline({ ...base, posts: [post()] })).toBe("1 post going out on LinkedIn.");
  });

  it("lists several without repeating a platform", () => {
    const t = { ...base, posts: [post(), post({ id: "q2" }), post({ id: "q3", platform: "x", platformLabel: "X" })] };
    expect(tomorrowHeadline(t)).toBe("3 posts going out on LinkedIn and X.");
  });

  it("says which kind of empty it is, because they need different answers", () => {
    expect(tomorrowHeadline({ ...base, idleReason: "not_configured" })).toMatch(/Nothing is planned yet/);
    expect(tomorrowHeadline({ ...base, idleReason: "paused" })).toMatch(/paused/);
    expect(tomorrowHeadline({ ...base, idleReason: "nothing_due" })).toMatch(/Nothing is scheduled/);
  });
});
