import {
  MARKET_SOURCES, type MarketQuery, type MarketSignal, type MarketSource,
  type MarketSourceId, type SignalKind, type SourceCapabilities, type SourceHealth,
} from "./types";
import { clamp01, hash, idFrom, normalizeTopic, saturate, DAY_MS } from "./util";

// Market source adapters. Provider-specific behaviour lives ONLY here — every core
// service consumes the normalized MarketSignal. These are deterministic reference
// adapters (no vendor SDKs, no network) so the whole intelligence layer runs and is
// testable offline; real providers implement the same MarketSource interface and drop in
// without touching a single core service.

type SourceSpec = {
  label: string;
  kinds: SignalKind[];
  rateLimitPerMin: number;
  incremental: boolean;
  /** Base weight — how strong this source's signals read relative to others. */
  weight: number;
};

const SPECS: Record<MarketSourceId, SourceSpec> = {
  google_trends:  { label: "Google Trends",       kinds: ["trend", "keyword"],            rateLimitPerMin: 10, incremental: true,  weight: 0.95 },
  reddit:         { label: "Reddit",              kinds: ["discussion", "trend"],         rateLimitPerMin: 30, incremental: true,  weight: 0.75 },
  news:           { label: "News",                kinds: ["article", "trend"],            rateLimitPerMin: 20, incremental: true,  weight: 0.8 },
  rss:            { label: "RSS",                 kinds: ["article"],                     rateLimitPerMin: 60, incremental: true,  weight: 0.6 },
  competitor_web: { label: "Competitor websites", kinds: ["competitor_post", "article"],  rateLimitPerMin: 15, incremental: false, weight: 0.85 },
  social:         { label: "Connected social",    kinds: ["engagement", "competitor_post"], rateLimitPerMin: 30, incremental: true, weight: 0.9 },
  analytics:      { label: "Analytics",           kinds: ["keyword", "engagement"],       rateLimitPerMin: 30, incremental: true,  weight: 1.0 },
};

// Deterministic topic vocabulary per source, derived from the query terms so results are
// always about the tenant's actual market rather than a fixed fake list.
function topicsFor(source: MarketSourceId, q: MarketQuery, n: number): string[] {
  const seeds = q.terms.length ? q.terms : [q.industry || "marketing"];
  const modifiers: Record<MarketSourceId, string[]> = {
    google_trends:  ["pricing", "alternatives", "vs", "review", "tutorial"],
    reddit:         ["experiences", "advice", "problems", "recommendations", "rant"],
    news:           ["funding", "launch", "regulation", "acquisition", "report"],
    rss:            ["guide", "update", "release notes", "changelog", "roundup"],
    competitor_web: ["case study", "customers", "product update", "webinar", "pricing page"],
    social:         ["thread", "carousel", "announcement", "poll", "demo"],
    analytics:      ["organic", "branded", "long tail", "converting", "declining"],
  };
  const mods = modifiers[source];
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const seed = seeds[i % seeds.length];
    const mod = mods[(i + hash(source)) % mods.length];
    out.push(normalizeTopic(`${seed} ${mod}`));
  }
  return out;
}

class ReferenceMarketSource implements MarketSource {
  constructor(readonly id: MarketSourceId, private now: () => number = () => 0) {}

  capabilities(): SourceCapabilities {
    const s = SPECS[this.id];
    return { id: this.id, label: s.label, kinds: s.kinds, rateLimitPerMin: s.rateLimitPerMin, incremental: s.incremental };
  }

  async health(): Promise<SourceHealth> {
    return { source: this.id, healthy: true };
  }

  async collect(query: MarketQuery): Promise<MarketSignal[]> {
    const spec = SPECS[this.id];
    const limit = Math.max(1, Math.min(50, query.limit ?? 8));
    const topics = topicsFor(this.id, query, limit);
    const now = this.now();

    const signals: MarketSignal[] = topics.map((topic, i) => {
      const seed = `${this.id}:${topic}:${query.tenant}`;
      const h = hash(seed);
      // Deterministic but varied metrics, normalized into 0..1 by the adapter.
      const rawVolume = 50 + (h % 4000);
      const rawGrowth = ((h >> 7) % 200) - 60;      // -60..139 (%)
      const observedAt = now - (i % 14) * DAY_MS;

      const kind: SignalKind = spec.kinds[i % spec.kinds.length];
      const competitor = kind === "competitor_post" && query.competitors?.length
        ? query.competitors[i % query.competitors.length]
        : undefined;

      return {
        id: idFrom("sig", this.id, topic, query.tenant),
        source: this.id,
        kind,
        topic,
        title: titleFor(this.id, topic, competitor),
        url: `populr://source/${this.id}/${hash(topic).toString(16)}`,
        strength: clamp01(saturate(rawVolume, 1500) * spec.weight),
        velocity: clamp01((rawGrowth + 60) / 200),
        audience: query.audience,
        competitor,
        observedAt,
        raw: { volume: rawVolume, growthPct: rawGrowth, source: this.id },
      };
    });

    // Honour incremental refresh — callers pass `since` to avoid reprocessing.
    const since = query.since ?? 0;
    return signals.filter((s) => s.observedAt >= since);
  }
}

function titleFor(source: MarketSourceId, topic: string, competitor?: string): string {
  switch (source) {
    case "google_trends": return `Rising searches for "${topic}"`;
    case "reddit": return `Discussion: ${topic}`;
    case "news": return `Coverage: ${topic}`;
    case "rss": return `Article: ${topic}`;
    case "competitor_web": return competitor ? `${competitor} — ${topic}` : `Competitor page: ${topic}`;
    case "social": return competitor ? `${competitor} posted about ${topic}` : `Social activity: ${topic}`;
    case "analytics": return `Your traffic: ${topic}`;
  }
}

/** All reference sources, keyed by id. */
export function createReferenceSources(now: () => number = () => 0): Record<MarketSourceId, MarketSource> {
  const out = {} as Record<MarketSourceId, MarketSource>;
  for (const id of MARKET_SOURCES) out[id] = new ReferenceMarketSource(id, now);
  return out;
}

/** Registry — the only way services reach a source. Adapters are interchangeable. */
export class SourceRegistry {
  private sources = new Map<MarketSourceId, MarketSource>();
  register(s: MarketSource): this { this.sources.set(s.id, s); return this; }
  get(id: MarketSourceId): MarketSource | null { return this.sources.get(id) ?? null; }
  list(): MarketSource[] { return [...this.sources.values()]; }
  ids(): MarketSourceId[] { return [...this.sources.keys()]; }
  capabilities(): SourceCapabilities[] { return this.list().map((s) => s.capabilities()); }
  async health(): Promise<SourceHealth[]> { return Promise.all(this.list().map((s) => s.health())); }
}

export function createSourceRegistry(now: () => number = () => 0): SourceRegistry {
  const reg = new SourceRegistry();
  const refs = createReferenceSources(now);
  for (const id of MARKET_SOURCES) reg.register(refs[id]);
  return reg;
}

export { SPECS as SOURCE_SPECS };
