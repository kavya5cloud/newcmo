import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAccessToken, queryAnalytics, isoDaysAgo, listSites, ensureGoogleTable } from "@/lib/google";
import {
  ensureIntelTables,
  saveOutcomeSnapshot,
  computeDelta,
  associationScore,
  scoreConfidence,
  type SnapshotMetrics,
} from "@/lib/intel";

export const runtime = "nodejs";
export const maxDuration = 60;

// Weekly outcome capture + attribution pass.
//   Phase 1 — for every user with a Google Search Console connection, snapshot each
//   verified site's last-7-day metrics (append-only; never overwrites).
//   Phase 2 — for approved recommendations that now have a snapshot before approval and
//   one ≥6 days after, compute the delta and store an association score (NOT causality).

function authCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "development";
  return req.headers.get("authorization") === "Bearer " + secret;
}

function log(event: string, data: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...data }));
}

/** Normalize a GSC property ("sc-domain:example.com" / "https://www.example.com/") to a bare host. */
function siteHost(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.slice("sc-domain:".length).replace(/^www\./, "");
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, "");
  } catch {
    return siteUrl;
  }
}

async function captureSite(token: string, site: string): Promise<SnapshotMetrics | null> {
  const start = isoDaysAgo(9);
  const end = isoDaysAgo(2); // GSC data lags ~2 days
  const [totals, byQuery, byPage] = await Promise.all([
    queryAnalytics(token, site, start, end, []),
    queryAnalytics(token, site, start, end, ["query"]),
    queryAnalytics(token, site, start, end, ["page"]),
  ]);
  const t = totals[0];
  if (!t) return null;
  return {
    impressions: t.impressions,
    clicks: t.clicks,
    ctr: t.ctr,
    position: t.position,
    topQueries: byQuery.slice(0, 10).map((r) => ({
      query: r.keys?.[0] || "", clicks: r.clicks, impressions: r.impressions, position: r.position,
    })),
    topPages: byPage.slice(0, 10).map((r) => ({
      page: r.keys?.[0] || "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr,
    })),
  };
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false });

  await ensureGoogleTable(sql);
  await ensureIntelTables(sql);

  /* ---- Phase 1: snapshots ---- */
  let snapshots = 0;
  const users = (await sql`SELECT user_id FROM google_tokens LIMIT 200`) as { user_id: string }[];
  for (const { user_id } of users) {
    try {
      const token = await getAccessToken(sql, user_id);
      if (!token) continue;
      const sites = (await listSites(token)).slice(0, 5);
      for (const site of sites) {
        const metrics = await captureSite(token, site);
        if (!metrics) continue;
        await saveOutcomeSnapshot(sql, "user:" + user_id, site, 7, metrics);
        snapshots++;
      }
    } catch (e) {
      log("outcome_snapshot_error", { userId: user_id, detail: String(e).slice(0, 150) });
    }
  }
  log("outcome_snapshots_captured", { users: users.length, snapshots });

  /* ---- Phase 2: attribution scores ---- */
  // Approved recommendations without a score yet, old enough to have an "after" window.
  const candidates = (await sql`
    SELECT r.id, r.workspace_key, r.host,
           (SELECT MIN(e.created_at) FROM recommendation_events e
            WHERE e.recommendation_id = r.id AND e.event = 'approved') AS approved_at
    FROM recommendations r
    WHERE EXISTS (SELECT 1 FROM recommendation_events e
                  WHERE e.recommendation_id = r.id AND e.event = 'approved')
      AND NOT EXISTS (SELECT 1 FROM recommendation_scores s WHERE s.recommendation_id = r.id)
    ORDER BY r.generated_at
    LIMIT 50`) as { id: string; workspace_key: string; host: string; approved_at: string }[];

  let scored = 0;
  for (const c of candidates) {
    try {
      const approvedAt = new Date(c.approved_at);
      if (Date.now() - approvedAt.getTime() < 6 * 86_400_000) continue; // "after" window not mature

      const snaps = (await sql`
        SELECT id, site_url, metrics, captured_at FROM outcome_snapshots
        WHERE workspace_key = ${c.workspace_key}
        ORDER BY captured_at`) as { id: string; site_url: string; metrics: SnapshotMetrics; captured_at: string }[];
      const forHost = snaps.filter((s) => siteHost(s.site_url) === c.host);

      const before = [...forHost].reverse().find((s) => new Date(s.captured_at) <= approvedAt);
      const after = forHost.find((s) => new Date(s.captured_at).getTime() >= approvedAt.getTime() + 6 * 86_400_000);
      if (!before || !after) continue;

      const delta = computeDelta(before.metrics, after.metrics);
      const score = associationScore(delta);
      const confidence = scoreConfidence(before.metrics.impressions, after.metrics.impressions);
      await sql`
        INSERT INTO recommendation_scores
          (recommendation_id, before_snapshot_id, after_snapshot_id, delta, association_score, confidence)
        VALUES (${c.id}, ${before.id}, ${after.id}, ${JSON.stringify(delta)}, ${score}, ${confidence})
        ON CONFLICT (recommendation_id, before_snapshot_id, after_snapshot_id) DO NOTHING`;
      scored++;
    } catch (e) {
      log("attribution_error", { recId: c.id, detail: String(e).slice(0, 150) });
    }
  }
  log("attribution_pass_complete", { candidates: candidates.length, scored });

  return NextResponse.json({ ok: true, snapshots, candidates: candidates.length, scored });
}
