import { describe, expect, it } from "vitest";
import { FEED_AGENT_IDS, buildAgentFeed, type FeedFacts } from "@/lib/agent-feed";

// The feed was two fixed lines per agent, derived from the profile and the URL. Both are
// stable, so the board showed the same eight suggestions on day one and day ninety — which
// makes a product whose promise is "your marketing is being worked on" look like a
// screenshot. These assert it moves, and that it moves sensibly.

const DAY = 86_400_000;
const facts: FeedFacts = {
  host: "acme.com",
  brand: "Acme",
  oneLiner: "invoicing that chases payment for you",
  audience: "freelancers",
  position: "Get paid faster without chasing anyone.",
};

const start = Date.UTC(2026, 1, 3, 9, 0);
const linesOn = (at: number, agent = "seo") => buildAgentFeed(facts, at)[agent].items.map(([t]) => t);

describe("the board changes with the calendar", () => {
  it("shows different work today than yesterday", () => {
    for (const agent of FEED_AGENT_IDS) {
      const today = linesOn(start, agent).join("|");
      const tomorrow = linesOn(start + DAY, agent).join("|");
      expect(tomorrow, `${agent} showed the same items two days running`).not.toBe(today);
    }
  });

  it("stays put through the day, so a reload does not reshuffle it", () => {
    // Someone half way through the list should not lose their place at 3pm.
    expect(linesOn(start)).toEqual(linesOn(start + 8 * 3_600_000));
  });

  it("works through the whole pool rather than cycling two items", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 14; i++) for (const l of linesOn(start + i * DAY)) seen.add(l);
    // Two items a day over a seven-deep pool should surface all of them.
    expect(seen.size).toBeGreaterThanOrEqual(7);
  });

  it("comes back around, so the rotation is a loop and not a dead end", () => {
    expect(linesOn(start + 7 * DAY)).toEqual(linesOn(start));
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
