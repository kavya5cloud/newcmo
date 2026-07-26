import type { SourceRegistry } from "./sources";
import {
  MarketError, type MarketQuery, type MarketSignal, type MarketSourceId, type SourceHealth,
} from "./types";
import { idFrom } from "./util";

// SignalAggregator — collects from every source and returns one deduplicated, ordered
// signal set. Owns the cross-cutting concerns so no individual service repeats them:
// caching, per-source rate limiting, retry with backoff, incremental refresh and
// GRACEFUL DEGRADATION (one dead source must never fail the whole collection).

type CacheEntry = { at: number; signals: MarketSignal[] };

export type AggregatorOptions = {
  now?: () => number;
  /** Cache TTL for a (source, query) pair. */
  ttlMs?: number;
  maxRetries?: number;
};

export type CollectionResult = {
  signals: MarketSignal[];
  /** Sources that returned data, and those that failed (degraded but not fatal). */
  ok: MarketSourceId[];
  failed: { source: MarketSourceId; error: string }[];
  cached: MarketSourceId[];
  collectedAt: number;
};

export class SignalAggregator {
  private cache = new Map<string, CacheEntry>();
  private calls = new Map<MarketSourceId, number[]>();   // sliding-window rate limiting
  private now: () => number;
  private ttlMs: number;
  private maxRetries: number;

  constructor(private registry: SourceRegistry, opts: AggregatorOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? 15 * 60_000;
    this.maxRetries = opts.maxRetries ?? 2;
  }

  private key(source: MarketSourceId, q: MarketQuery): string {
    return idFrom("q", source, q.tenant, q.terms.join(","), q.competitors?.join(",") ?? "", q.since ?? 0, q.limit ?? 0);
  }

  /** Sliding 60s window per source, using each adapter's declared limit. */
  private rateLimited(source: MarketSourceId): boolean {
    const src = this.registry.get(source);
    if (!src) return false;
    const limit = src.capabilities().rateLimitPerMin;
    const win = (this.calls.get(source) ?? []).filter((t) => t > this.now() - 60_000);
    this.calls.set(source, win);
    return win.length >= limit;
  }
  private recordCall(source: MarketSourceId) {
    const win = this.calls.get(source) ?? [];
    win.push(this.now());
    this.calls.set(source, win);
  }

  /** Collect from one source with cache → rate limit → retry. Throws MarketError. */
  private async collectOne(source: MarketSourceId, q: MarketQuery): Promise<{ signals: MarketSignal[]; fromCache: boolean }> {
    const src = this.registry.get(source);
    if (!src) throw new MarketError(`no adapter for ${source}`, "source_unavailable", source);

    const k = this.key(source, q);
    const hit = this.cache.get(k);
    if (hit && this.now() - hit.at < this.ttlMs) return { signals: hit.signals, fromCache: true };

    if (this.rateLimited(source)) throw new MarketError(`${source} rate limited`, "rate_limited", source);

    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        this.recordCall(source);
        const signals = await src.collect(q);
        this.cache.set(k, { at: this.now(), signals });
        return { signals, fromCache: false };
      } catch (e) {
        lastErr = e;
      }
    }
    throw new MarketError(`${source} failed: ${String(lastErr).slice(0, 120)}`, "source_unavailable", source);
  }

  /**
   * Collect across every registered source. Degrades gracefully: failures are reported,
   * never thrown, so intelligence still ships from whatever succeeded.
   */
  async collect(q: MarketQuery, sources?: MarketSourceId[]): Promise<CollectionResult> {
    if (!q.terms.length && !q.industry) {
      throw new MarketError("query needs at least one term or an industry", "invalid_query");
    }
    const ids = sources ?? this.registry.ids();
    const ok: MarketSourceId[] = [];
    const cached: MarketSourceId[] = [];
    const failed: { source: MarketSourceId; error: string }[] = [];
    const all: MarketSignal[] = [];

    const results = await Promise.allSettled(ids.map(async (id) => ({ id, ...(await this.collectOne(id, q)) })));
    for (const r of results) {
      if (r.status === "fulfilled") {
        all.push(...r.value.signals);
        ok.push(r.value.id);
        if (r.value.fromCache) cached.push(r.value.id);
      } else {
        const e = r.reason as MarketError;
        failed.push({ source: e.source ?? "rss", error: e.message ?? String(e) });
        console.info(JSON.stringify({ event: "market_source_failed", source: e.source, reason: e.reason }));
      }
    }

    const signals = dedupe(all).sort(
      (a, b) => b.strength * b.velocity - a.strength * a.velocity || a.id.localeCompare(b.id)
    );
    console.info(JSON.stringify({ event: "market_collect", tenant: q.tenant, signals: signals.length, ok: ok.length, failed: failed.length }));
    return { signals, ok, failed, cached, collectedAt: this.now() };
  }

  clearCache() { this.cache.clear(); }
  async health(): Promise<SourceHealth[]> { return this.registry.health(); }
}

/** Same topic from the same source is one signal — keep the strongest. */
export function dedupe(signals: MarketSignal[]): MarketSignal[] {
  const best = new Map<string, MarketSignal>();
  for (const s of signals) {
    const k = `${s.source}:${s.topic}`;
    const cur = best.get(k);
    if (!cur || s.strength > cur.strength) best.set(k, s);
  }
  return [...best.values()];
}
