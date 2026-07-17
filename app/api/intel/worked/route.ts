import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey, ensureIntelTables } from "@/lib/intel";

export const runtime = "nodejs";

// "What Actually Worked" — this workspace's recommendations ranked by measured outcome.
// Scored rows (before/after GSC snapshots exist) rank by association score; the response
// also includes per-channel funnel stats (generated → drafted → approved → published).
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false, worked: [], channels: [] });

  const key = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const sort = req.nextUrl.searchParams.get("sort") || "score";
  try {
    await ensureIntelTables(sql);

    const scored = (await sql`
      SELECT r.id, r.channel, r.title, r.host, r.generated_at,
             s.delta, s.association_score, s.confidence, s.computed_at
      FROM recommendation_scores s
      JOIN recommendations r ON r.id = s.recommendation_id
      WHERE r.workspace_key = ${key}
      ORDER BY
        CASE WHEN ${sort} = 'ctr'      THEN (s.delta->'ctr'->>'pct')::float
             WHEN ${sort} = 'traffic'  THEN (s.delta->'clicks'->>'pct')::float
             WHEN ${sort} = 'ranking'  THEN -((s.delta->'position'->>'change')::float)
             ELSE s.association_score
        END DESC NULLS LAST
      LIMIT 25`) as {
      id: string; channel: string; title: string; host: string; generated_at: string;
      delta: unknown; association_score: number; confidence: number; computed_at: string;
    }[];

    const channels = (await sql`
      SELECT r.channel,
             COUNT(DISTINCT r.id)::int AS generated,
             COUNT(DISTINCT e.recommendation_id) FILTER (WHERE e.event = 'drafted')::int   AS drafted,
             COUNT(DISTINCT e.recommendation_id) FILTER (WHERE e.event = 'approved')::int  AS approved,
             COUNT(DISTINCT e.recommendation_id) FILTER (WHERE e.event = 'published')::int AS published,
             AVG(s.association_score) AS avg_score
      FROM recommendations r
      LEFT JOIN recommendation_events e ON e.recommendation_id = r.id AND e.event IN ('drafted','approved','published')
      LEFT JOIN recommendation_scores s ON s.recommendation_id = r.id
      WHERE r.workspace_key = ${key}
      GROUP BY r.channel
      ORDER BY approved DESC, generated DESC`) as {
      channel: string; generated: number; drafted: number; approved: number; published: number; avg_score: number | null;
    }[];

    return NextResponse.json({
      enabled: true,
      worked: scored.map((r) => ({
        id: r.id,
        channel: r.channel,
        title: r.title,
        host: r.host,
        generatedAt: r.generated_at,
        delta: r.delta,
        score: r.association_score,
        confidence: r.confidence,
        computedAt: r.computed_at,
      })),
      channels: channels.map((c) => ({
        channel: c.channel,
        generated: c.generated,
        drafted: c.drafted,
        approved: c.approved,
        published: c.published,
        approvalRate: c.generated ? c.approved / c.generated : 0,
        avgScore: c.avg_score == null ? null : Number(c.avg_score),
      })),
    });
  } catch (e) {
    return NextResponse.json({ enabled: false, worked: [], channels: [], error: String(e).slice(0, 150) }, { status: 502 });
  }
}
