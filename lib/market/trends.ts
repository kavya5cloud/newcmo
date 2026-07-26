import type { MarketSignal, MarketSourceId, Trend, TrendKind } from "./types";
import { clamp01, idFrom, mean, normalizeTopic, round, saturate, DAY_MS } from "./util";

// TrendService — aggregates raw signals into ranked trends. Deterministic: identical
// signals always yield identical trends and confidence scores.
//
// Confidence deliberately rewards CORROBORATION: a topic seen by several independent
// sources is far more trustworthy than one loud source, which is exactly how a human
// analyst would read it.

const VIRAL_VELOCITY = 0.8;
const VIRAL_STRENGTH = 0.6;
const EMERGING_MAX_AGE = 7 * DAY_MS;

/** Classify a topic from its aggregate behaviour. */
function classify(topic: string, strength: number, velocity: number, ageMs: number, sources: MarketSourceId[]): TrendKind {
  if (velocity >= VIRAL_VELOCITY && strength >= VIRAL_STRENGTH) return "viral";
  if (/\b(q[1-4]|holiday|christmas|black friday|summer|winter|new year|back to school)\b/.test(topic)) return "seasonal";
  if (topic.startsWith("#")) return "hashtag";
  if (ageMs <= EMERGING_MAX_AGE && velocity >= 0.6) return "emerging";
  if (sources.includes("news") || sources.includes("rss")) return "industry";
  return "topic";
}

export type TrendOptions = { now?: () => number; minSignals?: number };

export class TrendService {
  private now: () => number;
  private minSignals: number;

  constructor(opts: TrendOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.minSignals = opts.minSignals ?? 1;
  }

  /** Aggregate signals into ranked trends (strongest first). */
  detect(signals: MarketSignal[]): Trend[] {
    const groups = new Map<string, MarketSignal[]>();
    for (const s of signals) {
      const key = normalizeTopic(s.topic);
      if (!key) continue;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
    }

    const trends: Trend[] = [];
    for (const [topic, group] of groups) {
      if (group.length < this.minSignals) continue;

      const sources = [...new Set(group.map((g) => g.source))].sort();
      const strength = clamp01(mean(group.map((g) => g.strength)));
      const velocity = clamp01(mean(group.map((g) => g.velocity)));
      const firstSeen = Math.min(...group.map((g) => g.observedAt));
      const lastSeen = Math.max(...group.map((g) => g.observedAt));

      // Corroboration across independent sources is the dominant confidence term.
      const corroboration = saturate(sources.length - 1, 1.5);      // 0 for a single source
      const volume = saturate(group.length, 4);
      const confidence = clamp01(0.55 * corroboration + 0.25 * volume + 0.20 * strength);

      trends.push({
        id: idFrom("trend", topic),
        topic,
        kind: classify(topic, strength, velocity, Math.max(0, this.now() - firstSeen), sources),
        strength: round(strength),
        velocity: round(velocity),
        confidence: round(confidence),
        sources,
        signalCount: group.length,
        firstSeen,
        lastSeen,
        sampleTitles: group.slice(0, 3).map((g) => g.title),
      });
    }

    return trends.sort(
      (a, b) => b.confidence * b.strength - a.confidence * a.strength || a.id.localeCompare(b.id)
    );
  }

  /** Trends of a given kind, strongest first. */
  byKind(trends: Trend[], kind: TrendKind): Trend[] {
    return trends.filter((t) => t.kind === kind);
  }

  /** Fast-moving trends worth acting on now. */
  rising(trends: Trend[], minVelocity = 0.6): Trend[] {
    return trends.filter((t) => t.velocity >= minVelocity);
  }
}
