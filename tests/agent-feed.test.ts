import { describe, expect, it } from "vitest";
import { FEED_AGENT_IDS, FEED_SLOT_MS, buildAgentFeed, feedIsFresh, type FeedFacts } from "@/lib/agent-feed";

// The feed was two fixed lines per agent, derived from the profile and the URL. Both are
// stable, so the board showed the same eight suggestions on day one and day ninety — which
// makes a product whose promise is "your marketing is being worked on" look like a
// screenshot. These assert it moves, and that it moves sensibly.

const DAY = 86_400_000;
const SLOT = FEED_SLOT_MS;   // 12 hours
const facts: FeedFacts = {
  host: "acme.com",
  brand: "Acme",
  oneLiner: "invoicing that chases payment for you",
  audience: "freelancers",
  position: "Get paid faster without chasing anyone.",
};

const start = Date.UTC(2026, 1, 3, 9, 0);
const linesOn = (at: number, agent = "seo") => buildAgentFeed(facts, at)[agent].items.map(([t]) => t);

describe("the board changes twice a day", () => {
  it("shows different work in the next 12-hour slot", () => {
    for (const agent of FEED_AGENT_IDS) {
      const now = linesOn(start, agent).join("|");
      const later = linesOn(start + SLOT, agent).join("|");
      expect(later, `${agent} showed the same items across a slot boundary`).not.toBe(now);
    }
  });

  it("turns over morning and evening rather than once a day", () => {
    const morning = linesOn(start).join("|");
    const evening = linesOn(start + SLOT).join("|");
    const nextMorning = linesOn(start + DAY).join("|");
    expect(evening).not.toBe(morning);
    expect(nextMorning).not.toBe(evening);
  });

  it("stays put inside a slot, so a reload does not reshuffle it", () => {
    // Slots align to 00:00 and 12:00 UTC, so this samples 09:00 and 11:00 — the same slot.
    // Someone half way through the list should not lose their place an hour later.
    expect(linesOn(start)).toEqual(linesOn(start + 2 * 3_600_000));
  });

  it("turns over exactly on the slot boundary, not at some arbitrary hour", () => {
    const boundary = Date.UTC(2026, 1, 3, 12, 0);
    expect(linesOn(boundary - 1000)).not.toEqual(linesOn(boundary));
  });

  it("works through the whole pool rather than cycling two items", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 14; i++) for (const l of linesOn(start + i * SLOT)) seen.add(l);
    // Two items a day over a seven-deep pool should surface all of them.
    expect(seen.size).toBeGreaterThanOrEqual(7);
  });

  it("comes back around, so the rotation is a loop and not a dead end", () => {
    expect(linesOn(start + 7 * SLOT)).toEqual(linesOn(start));
  });

  it("does not move every agent in lockstep", () => {
    // If all agents rotated together the board would read as one thing changing, not seven.
    const offsets = FEED_AGENT_IDS.map((id) => buildAgentFeed(facts, start)[id].items[0]);
    expect(new Set(offsets.map((o) => o[0])).size).toBe(FEED_AGENT_IDS.length);
  });
});

describe("what the items say", () => {
  it("covers every agent the dashboard renders", () => {
    const feed = buildAgentFeed(facts, start);
    for (const id of ["reddit", "seo", "geo", "x", "linkedin", "articles", "hn"]) {
      expect(feed[id], `${id} has no feed`).toBeTruthy();
      expect(feed[id].items.length).toBeGreaterThan(0);
      expect(feed[id].summary.length).toBeGreaterThan(0);
    }
  });

  it("is written about the actual business", () => {
    const all = Object.values(buildAgentFeed(facts, start))
      .flatMap((e) => [e.summary, ...e.items.map(([t]) => t)])
      .join(" ");
    expect(all).toContain("Acme");
    expect(all).toContain("acme.com");
  });

  it("gives every item something to do", () => {
    for (const entry of Object.values(buildAgentFeed(facts, start))) {
      for (const [label, action] of entry.items) {
        expect(label.trim().length).toBeGreaterThan(0);
        expect(action.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("reads cleanly when the profile is thin", () => {
    const bare = buildAgentFeed({ host: "acme.com", brand: "acme.com", oneLiner: "your product", audience: "buyers", position: "" }, start);
    const all = Object.values(bare).flatMap((e) => e.items.map(([t]) => t)).join(" ");
    expect(all).not.toContain("undefined");
    expect(all).not.toContain("null");
    expect(all).not.toMatch(/\s{3,}/);   // the old topic bug left gaps where words were cut
  });
});

describe("a saved feed cannot freeze the board", () => {
  // The actual reason nothing changed: the dashboard renders a saved feed when one exists,
  // and a saved feed was written once and kept forever. Rotating the fallback underneath it
  // was invisible. A saved feed now expires with its slot.
  const now = Date.UTC(2026, 1, 3, 9, 0);

  it("treats a feed with no timestamp as stale", () => {
    // Every feed saved before this change has no stamp. Those are exactly the frozen ones.
    expect(feedIsFresh(undefined, now)).toBe(false);
  });

  it("keeps a freshly generated feed", () => {
    expect(feedIsFresh(now - 60_000, now)).toBe(true);
  });

  it("lets go of one older than its slot", () => {
    expect(feedIsFresh(now - SLOT - 1, now)).toBe(false);
    expect(feedIsFresh(now - SLOT + 1000, now)).toBe(true);
  });
});
