import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey, ensureIntelTables, CHANNELS } from "@/lib/intel";

export const runtime = "nodejs";

// Decision engine v1 — "what should this company do next?", answered from data instead
// of asking an LLM. Ranks channels by blending:
//   - this workspace's own approval history and measured outcome scores
//   - global aggregated, de-identified channel effectiveness across all customers
//   - neutral priors when the dataset is still thin (cold start)
// The LLM stays the language interface; this ranking is the proprietary layer that
// improves as the recommendation → action → outcome dataset grows.

const PRIOR: Record<string, number> = {
  seo: 0.62, reddit: 0.58, articles: 0.55, geo: 0.54, linkedin: 0.5, x: 0.48, hn: 0.45,
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false, ranking: [] });

  const key = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  try {
    await ensureIntelTables(sql);

    type Agg = { channel: string; generated: number; approved: number; avg_score: number | null };
    const mine = (await sql`
      SELECT r.channel, COUNT(DISTINCT r.id)::int AS generated,
             COUNT(DISTINCT e.recommendation_id)::int AS approved,
             AVG(s.association_score) AS avg_score
      FROM recommendations r
      LEFT JOIN recommendation_events e ON e.recommendation_id = r.id AND e.event = 'approved'
      LEFT JOIN recommendation_scores s ON s.recommendation_id = r.id
      WHERE r.workspace_key = ${key}
      GROUP BY r.channel`) as Agg[];

    // Global: channel-level aggregates only — no workspace, site, or content identifiers.
    const global = (await sql`
      SELECT r.channel, COUNT(DISTINCT r.id)::int AS generated,
             COUNT(DISTINCT e.recommendation_id)::int AS approved,
             AVG(s.association_score) AS avg_score
      FROM recommendations r
      LEFT JOIN recommendation_events e ON e.recommendation_id = r.id AND e.event = 'approved'
      LEFT JOIN recommendation_scores s ON s.recommendation_id = r.id
      GROUP BY r.channel`) as Agg[];

    const mineBy = new Map(mine.map((a) => [a.channel, a]));
    const globalBy = new Map(global.map((a) => [a.channel, a]));

    const ranking = Object.keys(CHANNELS).map((channel) => {
      const m = mineBy.get(channel);
      const g = globalBy.get(channel);
      const prior = PRIOR[channel] ?? 0.5;

      // Each layer contributes proportionally to how much evidence it has (shrinkage
      // toward the prior — thin data barely moves the needle, rich data dominates).
      const mineScore = m?.avg_score != null ? Number(m.avg_score) : m && m.generated ? m.approved / m.generated : null;
      const mineWeight = m ? Math.min(1, m.generated / 20) * 0.6 : 0;
      const globalScore = g?.avg_score != null ? Number(g.avg_score) : g && g.generated ? g.approved / g.generated : null;
      const globalWeight = g ? Math.min(1, g.generated / 200) * 0.3 : 0;
      const priorWeight = 1 - mineWeight - globalWeight;

      const score =
        prior * priorWeight +
        (mineScore ?? prior) * mineWeight +
        (globalScore ?? prior) * globalWeight;

      return {
        channel,
        label: CHANNELS[channel],
        score: Number(score.toFixed(4)),
        evidence: {
          yours: m ? { generated: m.generated, approved: m.approved, avgScore: m.avg_score == null ? null : Number(m.avg_score) } : null,
          network: g ? { generated: g.generated, approved: g.approved } : null,
        },
      };
    }).sort((a, b) => b.score - a.score);

    return NextResponse.json({ enabled: true, ranking });
  } catch (e) {
    return NextResponse.json({ enabled: false, ranking: [], error: String(e).slice(0, 150) }, { status: 502 });
  }
}
