import type { CompetitorProfile, EngagementTrend, MarketSignal } from "./types";
import { clamp01, mean, round, terms, WEEK_MS } from "./util";

// CompetitorService — turns competitor-attributed signals into a profile: posting
// frequency, engagement trend, content mix, growth, top posts and campaign patterns.
// Deterministic and evidence-only: every number is computed from the observed signals,
// never invented. When there is too little data the profile says so rather than guessing.

const CATEGORY_RULES: { category: string; match: RegExp }[] = [
  { category: "product", match: /\b(product|feature|release|update|launch|changelog)\b/ },
  { category: "pricing", match: /\b(pricing|price|plan|cost|discount)\b/ },
  { category: "customer proof", match: /\b(case study|customer|testimonial|story|success)\b/ },
  { category: "education", match: /\b(guide|how|tutorial|tips|webinar|course)\b/ },
  { category: "company", match: /\b(hiring|funding|team|culture|award|acquisition)\b/ },
  { category: "thought leadership", match: /\b(future|opinion|why|trends|predictions|report)\b/ },
];

function categorize(title: string): string {
  const t = title.toLowerCase();
  for (const r of CATEGORY_RULES) if (r.match.test(t)) return r.category;
  return "other";
}

export type CompetitorOptions = { now?: () => number };

export class CompetitorService {
  private now: () => number;
  constructor(opts: CompetitorOptions = {}) { this.now = opts.now ?? Date.now; }

  /** Build one competitor's profile from its signals. */
  profile(name: string, signals: MarketSignal[]): CompetitorProfile {
    const own = signals.filter((s) => s.competitor === name);
    const observedFrom = own.length ? Math.min(...own.map((s) => s.observedAt)) : this.now();
    const observedTo = own.length ? Math.max(...own.map((s) => s.observedAt)) : this.now();
    const spanWeeks = Math.max(1, (observedTo - observedFrom) / WEEK_MS);

    const postingFrequencyPerWeek = round(own.length / spanWeeks, 2);
    const avgEngagement = round(mean(own.map((s) => s.strength)));

    // Engagement trend: compare the recent half against the older half.
    const ordered = [...own].sort((a, b) => a.observedAt - b.observedAt);
    const half = Math.floor(ordered.length / 2);
    let engagementTrend: EngagementTrend = "flat";
    let growthRate = 0;
    if (half >= 1) {
      const older = mean(ordered.slice(0, half).map((s) => s.strength));
      const recent = mean(ordered.slice(ordered.length - half).map((s) => s.strength));
      growthRate = round(older > 0 ? clamp01(Math.abs(recent - older) / older) * Math.sign(recent - older) : 0, 2);
      if (recent - older > 0.05) engagementTrend = "rising";
      else if (older - recent > 0.05) engagementTrend = "falling";
    }

    // Content mix.
    const counts = new Map<string, number>();
    for (const s of own) {
      const c = categorize(s.title);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const contentCategories = [...counts.entries()]
      .map(([category, n]) => ({ category, share: round(n / Math.max(1, own.length), 2) }))
      .sort((a, b) => b.share - a.share || a.category.localeCompare(b.category));

    const topPosts = [...own]
      .sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id))
      .slice(0, 3)
      .map((s) => ({ title: s.title, engagement: round(s.strength), url: s.url }));

    // Campaign patterns = categories they lean on repeatedly.
    const campaignPatterns = contentCategories
      .filter((c) => c.share >= 0.25 && c.category !== "other")
      .map((c) => `leans on ${c.category} content (${Math.round(c.share * 100)}% of posts)`);

    return {
      name,
      postingFrequencyPerWeek,
      engagementTrend,
      avgEngagement,
      growthRate,
      contentCategories,
      topPosts,
      campaignPatterns,
      summary: this.summarize(name, own.length, postingFrequencyPerWeek, engagementTrend, contentCategories),
      observedFrom,
      observedTo,
      postCount: own.length,
    };
  }

  /** Profiles for every named competitor, most active first. */
  profileAll(names: string[], signals: MarketSignal[]): CompetitorProfile[] {
    return names
      .map((n) => this.profile(n, signals))
      .sort((a, b) => b.postCount - a.postCount || a.name.localeCompare(b.name));
  }

  /** Deterministic narrative summary — states the evidence, never invents it. */
  private summarize(
    name: string, posts: number, freq: number, trend: EngagementTrend,
    categories: { category: string; share: number }[],
  ): string {
    if (posts === 0) return `No observed activity for ${name} in this window.`;
    const top = categories[0];
    const mix = top && top.category !== "other" ? ` Mostly ${top.category} content.` : "";
    const dir = trend === "rising" ? "Engagement is climbing." : trend === "falling" ? "Engagement is slipping." : "Engagement is steady.";
    return `${name} posted ${posts} time${posts === 1 ? "" : "s"} (~${freq}/week). ${dir}${mix}`;
  }

  /** Topics competitors cover that we have no signal of our own for — a content gap. */
  contentGaps(competitorSignals: MarketSignal[], ownTopics: string[]): string[] {
    const own = new Set(ownTopics.flatMap((t) => terms(t)));
    const gaps = new Map<string, number>();
    for (const s of competitorSignals) {
      if (!s.competitor) continue;
      for (const w of terms(s.topic)) if (!own.has(w)) gaps.set(w, (gaps.get(w) ?? 0) + 1);
    }
    return [...gaps.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([w]) => w);
  }
}
