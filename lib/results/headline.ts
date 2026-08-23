import { db } from "@/lib/db";

// What changed, in one sentence.
//
// The dashboard has always answered "is it running" — posts this week, next post tomorrow.
// That is activity. Nobody renews a subscription because a queue is full; they renew because
// something moved. The one screen a founder actually opens said nothing about whether any of
// it worked.
//
// The measurement already existed and was being thrown away. The weekly snapshot cron
// computes exactly this sentence and sends it as a push notification — so a customer with
// notifications off, which is most of them, generated the result and never saw it.
//
// Every number here comes from a Search Console snapshot this workspace owns. Nothing is
// modelled, estimated or inferred, and when there is nothing measured this returns null
// rather than a zero. A dashboard reporting "0% growth" for a business that simply has not
// been measured yet is worse than one that says nothing.

export type SnapshotMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topQueries?: { query: string; clicks: number; impressions: number; position: number }[];
};

export type Result = {
  /** The sentence, already written for a person. */
  text: string;
  /** Which measurement produced it, for the UI to decide emphasis. */
  kind: "rank" | "ctr" | "clicks" | "impressions";
  /** The site it was measured on. */
  site: string;
  /** When the later of the two snapshots was taken. */
  at: number;
};

const pct = (before: number, after: number) => (before > 0 ? (after - before) / before : 0);

/** Strip the scheme and any sc-domain: prefix, so a sentence reads like a person wrote it. */
export function siteLabel(site: string): string {
  return site.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * The most concrete improvement between two snapshots, or null.
 *
 * Ordered by how concrete the claim is rather than how large the number is: a named query
 * climbing the rankings is something a founder can go and look at, and "impressions up 30%"
 * is a number they have to take on trust. The thresholds are the same ones the notification
 * path already used — they exist so a fortnight of noise does not get reported as a win.
 *
 * Deliberately returns only improvements. This is the line that answers "is this working",
 * and a dashboard is not the place to learn that a metric dipped 4% — that belongs in the
 * full table on /worked, where it sits next to everything else and cannot be mistaken for
 * the headline.
 */
export function bestResult(
  prev: SnapshotMetrics,
  cur: SnapshotMetrics,
  site: string,
  at: number,
): Result | null {
  const label = siteLabel(site);

  // 1. A query this business cares about moved up. The most checkable claim available.
  const prevQ = new Map((prev.topQueries || []).map((q) => [q.query, q]));
  let best: { query: string; gain: number } | null = null;
  for (const q of cur.topQueries || []) {
    const p = prevQ.get(q.query);
    // Under twenty impressions a position is noise, not a ranking.
    if (!p || q.impressions < 20) continue;
    const gain = Math.round(p.position - q.position);
    if (gain >= 2 && (!best || gain > best.gain)) best = { query: q.query, gain };
  }
  if (best) {
    return { kind: "rank", site, at, text: `"${best.query}" moved up ${best.gain} places on Google.` };
  }

  const ctr = pct(prev.ctr, cur.ctr);
  if (ctr >= 0.1 && cur.impressions >= 100) {
    return { kind: "ctr", site, at, text: `More people clicked through — CTR up ${Math.round(ctr * 100)}% on ${label}.` };
  }

  const clicks = pct(prev.clicks, cur.clicks);
  if (clicks >= 0.15 && cur.clicks >= 10) {
    return { kind: "clicks", site, at, text: `Search clicks up ${Math.round(clicks * 100)}% this week — ${prev.clicks} to ${cur.clicks}.` };
  }

  const impressions = pct(prev.impressions, cur.impressions);
  if (impressions >= 0.25 && cur.impressions >= 200) {
    return { kind: "impressions", site, at, text: `${label} was seen ${Math.round(impressions * 100)}% more in Google this week.` };
  }

  return null;
}

type Row = { site_url: string; metrics: SnapshotMetrics; captured_at: string };

/**
 * The latest measured result for a workspace, or null.
 *
 * Two snapshots of one site are the minimum: a single snapshot is a reading, and a result is
 * a difference. A workspace that connected Search Console yesterday has one, and correctly
 * gets nothing until next week's capture.
 */
export async function latestResult(workspaceKey: string): Promise<Result | null> {
  const sql = db();
  if (!sql) return null;
  try {
    const rows = (await sql`
      SELECT site_url, metrics, captured_at FROM outcome_snapshots
      WHERE workspace_key = ${workspaceKey}
      ORDER BY captured_at DESC LIMIT 8`) as Row[];
    if (rows.length < 2) return null;

    // Compare within one site. A workspace with two verified properties would otherwise
    // difference one against the other and report a number belonging to neither.
    const bySite = new Map<string, Row[]>();
    for (const r of rows) {
      const list = bySite.get(r.site_url) ?? [];
      list.push(r);
      bySite.set(r.site_url, list);
    }

    for (const [site, list] of bySite) {
      if (list.length < 2) continue;
      const [cur, prev] = list; // already ordered newest first
      const result = bestResult(prev.metrics, cur.metrics, site, new Date(cur.captured_at).getTime());
      if (result) return result;
    }
    return null;
  } catch {
    return null;
  }
}
