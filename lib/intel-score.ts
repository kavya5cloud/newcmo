// Pure attribution math for the intelligence layer — no I/O, no framework imports,
// unit-tested in tests/intel-score.test.ts. These scores are ASSOCIATIONS between an
// approved recommendation and the following metric window, never causal claims.

export type SnapshotMetrics = {
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
  topQueries?: { query: string; clicks: number; impressions: number; position: number }[];
  topPages?: { page: string; clicks: number; impressions: number; ctr: number }[];
};

export type MetricDelta = {
  impressions: { before: number; after: number; pct: number };
  clicks: { before: number; after: number; pct: number };
  ctr: { before: number; after: number; pct: number };
  position: { before: number; after: number; change: number }; // negative change = improved rank
};

function pct(before: number, after: number): number {
  if (!before) return after ? 1 : 0;
  return (after - before) / before;
}

export function computeDelta(before: SnapshotMetrics, after: SnapshotMetrics): MetricDelta {
  return {
    impressions: { before: before.impressions, after: after.impressions, pct: pct(before.impressions, after.impressions) },
    clicks: { before: before.clicks, after: after.clicks, pct: pct(before.clicks, after.clicks) },
    ctr: { before: before.ctr, after: after.ctr, pct: pct(before.ctr, after.ctr) },
    position: { before: before.position, after: after.position, change: after.position - before.position },
  };
}

/**
 * Association score in [0, 1]: how positively the measured window moved after the action.
 * 0.5 = no movement. Weights favor clicks (real visits) over impressions, with a bonus
 * for rank improvement.
 */
export function associationScore(delta: MetricDelta): number {
  const clip = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  const clicksTerm = clip(delta.clicks.pct, -1, 1) * 0.45;
  const imprTerm = clip(delta.impressions.pct, -1, 1) * 0.25;
  const ctrTerm = clip(delta.ctr.pct, -1, 1) * 0.15;
  // Position: moving from 20 → 10 is change -10; normalize to [-1, 1] over a 20-rank swing.
  const posTerm = clip(-delta.position.change / 20, -1, 1) * 0.15;
  return clip(0.5 + (clicksTerm + imprTerm + ctrTerm + posTerm) / 2, 0, 1);
}

/**
 * Confidence in [0, 1] from data volume: tiny sites produce noisy percent swings.
 * ~0 below 50 weekly impressions, ~0.5 at 500, →1 as volume grows past ~5000.
 */
export function scoreConfidence(beforeImpressions: number, afterImpressions: number): number {
  const vol = (beforeImpressions + afterImpressions) / 2;
  if (vol <= 0) return 0;
  const c = Math.log10(vol / 50) / 2; // 50 → 0, 500 → .5, 5000 → 1
  return Math.max(0, Math.min(1, c));
}
