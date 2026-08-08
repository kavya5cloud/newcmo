// The agent board.
//
// Two jobs: build the rotating fallback when nothing has been generated, and merge a saved
// feed over it. The merge is the subtle part — a saved feed used to win permanently, which
// is why the board appeared frozen for weeks. See lib/agent-feed.ts for the slot rules.

import { buildAgentFeed, feedIsFresh } from "@/lib/agent-feed";
import { hostOf } from "./ai";
import type { Profile, FeedEntry } from "@/lib/store";

export function withHonestSummaries(feed: Record<string, FeedEntry>): Record<string, FeedEntry> {
  const out: Record<string, FeedEntry> = {};
  for (const [ch, entry] of Object.entries(feed)) {
    const n = entry.items?.length || 0;
    const honest = entry.summary && !/\d/.test(entry.summary)
      ? entry.summary
      : `${n} ${n === 1 ? "opportunity" : "opportunities"} ready to review`;
    out[ch] = { ...entry, summary: honest };
  }
  return out;
}

export function feedText(entry?: FeedEntry) {
  return (entry?.items || []).map(([t]) => t).join(" ").toLowerCase();
}

export function feedLooksGeneric(entry?: FeedEntry) {
  const text = feedText(entry);
  return !text || /cosmos(?:\.ai)?|populr|short (?:thread angle|keyword or fix|ai-search gap|post idea|article title)|draft reply|fix gap|review|open/.test(text) || text.length < 30;
}

/**
 * What each agent is working on today.
 *
 * The pools and the day rotation live in lib/agent-feed.ts. This used to be two fixed lines
 * per agent derived from the profile and URL — both stable, so the board never changed.
 */
export function buildFallbackFeed(profile: Profile | null, url: string, at: number = Date.now()): Record<string, FeedEntry> {
  const host = hostOf(url);
  const brand = profile?.name || host;
  return buildAgentFeed({
    host,
    brand,
    oneLiner: profile?.oneLiner || "your product",
    audience: profile?.audience || "buyers",
    position: profile?.positioning || `Position ${brand} around the main pain it solves.`,
  }, at);
}

/**
 * Merge a saved feed over the rotating one — but only while the saved one is current.
 *
 * This was the reason the board never changed. The spread put the saved feed last, so it
 * won every time, and a saved feed is written once and persisted forever. Rotating the
 * fallback underneath it changed nothing anyone could see.
 */
export function normalizeFeed(
  feed: Record<string, FeedEntry> | undefined,
  profile: Profile | null,
  url: string,
  feedAt?: number,
) {
  const fallback = buildFallbackFeed(profile, url);
  // Past its slot, the saved feed is history. The rotation takes over.
  const saved = feedIsFresh(feedAt) ? feed || {} : {};
  const out: Record<string, FeedEntry> = { ...fallback, ...saved };
  for (const id of ["hn", "linkedin"] as const) {
    if (feedLooksGeneric(out[id])) out[id] = fallback[id];
  }
  return out;
}

export function summarizeItems(items: [string, string][] | undefined, limit = 2) {
  return (items || []).slice(0, limit).map(([t]) => t).join(" | ");
}
