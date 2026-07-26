import type { KeywordCluster, KeywordInsight, MarketSignal } from "./types";
import { clamp01, mean, round, saturate, terms, DAY_MS } from "./util";

// KeywordService — discovery, opportunity scoring, trend history, clustering and content
// suggestions. Deterministic throughout.
//
// Opportunity deliberately favours "winnable demand": real volume and growth, discounted
// by how contested the term looks. A huge, brutal head term scores lower than a rising
// long-tail term we can actually rank for — which is the decision a marketer needs.

const WEIGHTS = { volume: 0.3, growth: 0.35, ease: 0.35 };

export type KeywordOptions = { now?: () => number };

export class KeywordService {
  private now: () => number;
  constructor(opts: KeywordOptions = {}) { this.now = opts.now ?? Date.now; }

  /** Discover keywords from signals, scored and clustered. */
  discover(signals: MarketSignal[], limit = 25): KeywordInsight[] {
    // Group signals by the terms they contain.
    const byTerm = new Map<string, MarketSignal[]>();
    for (const s of signals) {
      for (const t of terms(s.topic)) {
        (byTerm.get(t) ?? byTerm.set(t, []).get(t)!).push(s);
      }
    }

    const insights: KeywordInsight[] = [];
    for (const [keyword, group] of byTerm) {
      if (group.length < 2) continue;   // one mention isn't a keyword

      const volume = round(mean(group.map((g) => g.strength)));
      const growth = round(mean(group.map((g) => g.velocity)));
      // Difficulty rises with how crowded the term is (more sources competing for it)
      // and with raw volume — big terms are harder.
      const sources = new Set(group.map((g) => g.source)).size;
      const difficulty = round(clamp01(0.55 * saturate(sources, 3) + 0.45 * volume));
      const ease = 1 - difficulty;

      const opportunity = round(clamp01(
        WEIGHTS.volume * volume + WEIGHTS.growth * growth + WEIGHTS.ease * ease
      ));

      insights.push({
        keyword,
        volume,
        difficulty,
        opportunity,
        trendHistory: this.history(group),
        cluster: this.clusterName(keyword, group),
        contentSuggestions: this.suggest(keyword, group),
      });
    }

    return insights
      .sort((a, b) => b.opportunity - a.opportunity || a.keyword.localeCompare(b.keyword))
      .slice(0, limit);
  }

  /** Weekly volume history derived from when signals were observed. */
  private history(group: MarketSignal[]): { at: number; volume: number }[] {
    const buckets = new Map<number, number[]>();
    for (const s of group) {
      const day = Math.floor(s.observedAt / DAY_MS) * DAY_MS;
      (buckets.get(day) ?? buckets.set(day, []).get(day)!).push(s.strength);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([at, xs]) => ({ at, volume: round(mean(xs)) }));
  }

  /** Cluster by the dominant co-occurring term — keeps related keywords together. */
  private clusterName(keyword: string, group: MarketSignal[]): string {
    const co = new Map<string, number>();
    for (const s of group) {
      for (const t of terms(s.topic)) {
        if (t !== keyword) co.set(t, (co.get(t) ?? 0) + 1);
      }
    }
    const top = [...co.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return top ? top[0] : keyword;
  }

  private suggest(keyword: string, group: MarketSignal[]): string[] {
    const kinds = new Set(group.map((g) => g.kind));
    const out: string[] = [];
    if (kinds.has("discussion")) out.push(`Answer the recurring "${keyword}" question as a post`);
    if (kinds.has("article") || kinds.has("trend")) out.push(`Publish a guide targeting "${keyword}"`);
    if (kinds.has("competitor_post")) out.push(`Counter-position against competitor coverage of "${keyword}"`);
    if (out.length === 0) out.push(`Create a landing section for "${keyword}"`);
    return out.slice(0, 3);
  }

  /** Group insights into clusters, scored by mean opportunity. */
  cluster(insights: KeywordInsight[]): KeywordCluster[] {
    const groups = new Map<string, KeywordInsight[]>();
    for (const i of insights) {
      (groups.get(i.cluster) ?? groups.set(i.cluster, []).get(i.cluster)!).push(i);
    }
    return [...groups.entries()]
      .map(([name, ks]) => ({
        name,
        keywords: ks.map((k) => k.keyword).sort(),
        opportunity: round(mean(ks.map((k) => k.opportunity))),
      }))
      .sort((a, b) => b.opportunity - a.opportunity || a.name.localeCompare(b.name));
  }
}
