import type { Sql } from "@/lib/db";
import { ensureIntelTables, CHANNELS } from "@/lib/intel";
import type { RankedChannel } from "@/lib/services/contracts";

// Decision Engine — "what should this business do next?", answered from data.
// Blends three evidence layers with shrinkage toward neutral priors:
//   1. this workspace's own approval history + measured outcome scores (up to 60%)
//   2. global aggregated, de-identified channel effectiveness (up to 30%)
//   3. neutral priors (the remainder — dominant during cold start)
// Used by /api/intel/next and by the Campaign Planner (decide BEFORE the LLM plans).

const PRIOR: Record<string, number> = {
  seo: 0.62, reddit: 0.58, articles: 0.55, geo: 0.54, linkedin: 0.5, x: 0.48, hn: 0.45,
};

export async function rankChannels(sql: Sql, wsKey: string): Promise<RankedChannel[]> {
  await ensureIntelTables(sql);

  type Agg = { channel: string; generated: number; approved: number; avg_score: number | null };
  const mine = (await sql`
    SELECT r.channel, COUNT(DISTINCT r.id)::int AS generated,
           COUNT(DISTINCT e.recommendation_id)::int AS approved,
           AVG(s.association_score) AS avg_score
    FROM recommendations r
    LEFT JOIN recommendation_events e ON e.recommendation_id = r.id AND e.event = 'approved'
    LEFT JOIN recommendation_scores s ON s.recommendation_id = r.id
    WHERE r.workspace_key = ${wsKey}
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

  return Object.keys(CHANNELS).map((channel) => {
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
}
