import { dayIndex } from "@/lib/automation/topic";

// What each agent is working on today.
//
// The feed used to be two fixed lines per agent, built from the profile and the URL. Both of
// those are stable, so the feed was too: the same eight suggestions on day one and day
// ninety. A board that never changes stops being read — and worse, it makes a product whose
// whole promise is "your marketing is being worked on" look like a screenshot.
//
// Each agent now has a pool of angles and shows a couple, chosen by calendar day. Same two
// rules as the daily posting brief: consecutive days differ, and a given day is stable, so
// reloading at lunchtime does not shuffle the list you were half way through.

export type FeedItem = [string, string];
export type AgentFeedEntry = { summary: string; items: FeedItem[] };

export type FeedFacts = {
  host: string;
  brand: string;
  oneLiner: string;
  audience: string;
  position: string;
};

/** How many suggestions an agent shows at once. Enough to choose from, few enough to read. */
const PER_AGENT = 2;

type Pool = { summary: (f: FeedFacts) => string; angles: ((f: FeedFacts) => FeedItem)[] };

const POOLS: Record<string, Pool> = {
  reddit: {
    summary: (f) => `Discussion angles for ${f.host}`,
    angles: [
      (f) => [`Lead with the pain ${f.audience} feel before they buy`, "Draft reply"],
      (f) => [`Reply with a concrete example from ${f.brand}`, "Draft reply"],
      (f) => [`Answer "is this worth paying for?" without pitching`, "Draft reply"],
      (f) => [`Share what ${f.brand} deliberately does not do`, "Draft reply"],
      (f) => [`Explain the workaround ${f.audience} use today, and its cost`, "Draft reply"],
      (f) => [`Compare approaches honestly, including where you lose`, "Draft reply"],
      (f) => [`Post the number that surprised you building ${f.brand}`, "Draft reply"],
    ],
  },
  seo: {
    summary: (f) => `Search opportunities for ${f.host}`,
    angles: [
      (f) => [`Comparison page: ${f.brand} vs alternatives`, "Draft post"],
      (f) => [`FAQ page based on "${f.oneLiner}"`, "Draft post"],
      (f) => [`Landing page for the problem, not the product`, "Draft post"],
      (f) => [`"How to choose" guide for ${f.audience}`, "Draft post"],
      (f) => [`Pricing page copy that answers the real objection`, "Draft post"],
      (f) => [`Glossary entry defining the category ${f.brand} sits in`, "Draft post"],
      (f) => [`Case study framed around the outcome, not the feature`, "Draft post"],
    ],
  },
  geo: {
    summary: (f) => `AI citation opportunities for ${f.host}`,
    angles: [
      (f) => [`Add a crisp definition of ${f.brand} for AI answers`, "Fix gap"],
      (f) => [`Use FAQ schema so ${f.position.slice(0, 48).replace(/\s+/g, " ")}…`, "Fix gap"],
      (f) => [`State the category and the differentiator in one sentence`, "Fix gap"],
      (f) => [`Publish a comparison table models can quote`, "Fix gap"],
      (f) => [`Answer "what is ${f.brand}" in under 40 words on the page`, "Fix gap"],
      (f) => [`Add dates and numbers — models cite specifics`, "Fix gap"],
      (f) => [`Cover the question ${f.audience} ask before they trust you`, "Fix gap"],
    ],
  },
  x: {
    summary: (f) => `Social angles for ${f.host}`,
    angles: [
      (f) => [`Thread: the one thing ${f.brand} does that others don't`, "Draft"],
      (f) => [`Post: a before/after story for ${f.audience}`, "Draft"],
      (f) => [`Thread: what you got wrong first, and the fix`, "Draft"],
      (f) => [`Post: the smallest useful thing someone can try today`, "Draft"],
      (f) => [`Thread: a decision you made and why`, "Draft"],
      (f) => [`Post: one number and what it means`, "Draft"],
      (f) => [`Thread: the objection you hear most, answered`, "Draft"],
    ],
  },
  linkedin: {
    summary: (f) => `Founder posts for ${f.host}`,
    angles: [
      (f) => [`Founder post: why ${f.brand} exists and what it refuses to do`, "Review"],
      (f) => [`Post: one lesson from building ${f.oneLiner}`, "Review"],
      (f) => [`Post: what ${f.audience} keep asking you`, "Review"],
      (f) => [`Post: something that did not work, and what you learned`, "Review"],
      (f) => [`Post: the moment you knew the problem was real`, "Review"],
      (f) => [`Post: a practical breakdown of how you'd solve it manually`, "Review"],
      (f) => [`Post: what changed for a customer, in their words`, "Review"],
    ],
  },
  articles: {
    summary: (f) => `Long-form topics for ${f.host}`,
    angles: [
      (f) => [`"${f.brand} vs the old way: what changes"`, "Open"],
      (f) => [`"How ${f.audience} should evaluate tools like ${f.brand}"`, "Open"],
      (f) => [`"The real cost of doing this manually"`, "Open"],
      (f) => [`"What we learned shipping ${f.oneLiner}"`, "Open"],
      (f) => [`"A working setup for ${f.audience}, start to finish"`, "Open"],
      (f) => [`"Questions to ask before buying anything in this category"`, "Open"],
      (f) => [`"What nobody tells you about ${f.position.split(/[.,]/)[0].toLowerCase()}"`, "Open"],
    ],
  },
  hn: {
    summary: (f) => `Launch angles for ${f.host}`,
    angles: [
      (f) => [`Show HN draft: ${f.brand} — ${f.oneLiner}`, "Review"],
      (f) => [`Comment angle: explain the problem ${f.brand} removes`, "Review"],
      (f) => [`Write up the technical choice you'd defend`, "Review"],
      (f) => [`Answer the "why not just use X" question directly`, "Review"],
      (f) => [`Post the architecture decision and its trade-off`, "Review"],
      (f) => [`Share what broke in production and the fix`, "Review"],
      (f) => [`Explain what you'd do differently starting over`, "Review"],
    ],
  },
};

/** A stable per-agent offset, so agents don't all rotate in lockstep. */
function offsetFor(agentId: string, size: number): number {
  let n = 0;
  for (let i = 0; i < agentId.length; i++) n = (n + agentId.charCodeAt(i) * (i + 1)) % size;
  return n;
}

/**
 * The feed for one calendar day.
 *
 * `at` is injected rather than read from the clock so the result is testable and so a
 * reload mid-afternoon shows the same list as the morning.
 */
export function buildAgentFeed(facts: FeedFacts, at: number = Date.now()): Record<string, AgentFeedEntry> {
  const day = dayIndex(at);
  const out: Record<string, AgentFeedEntry> = {};

  for (const [id, pool] of Object.entries(POOLS)) {
    const n = pool.angles.length;
    const start = (day + offsetFor(id, n)) % n;
    const items: FeedItem[] = [];
    // Walk the pool from today's offset, so the pair moves along by one each day and every
    // angle comes round rather than two of them carrying the whole rotation.
    for (let i = 0; i < Math.min(PER_AGENT, n); i++) items.push(pool.angles[(start + i) % n](facts));
    out[id] = { summary: pool.summary(facts), items };
  }

  return out;
}

/** Agent ids this module can produce a feed for. */
export const FEED_AGENT_IDS = Object.keys(POOLS);
