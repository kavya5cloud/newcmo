import type { AudienceInsight, MarketSignal } from "./types";
import { clamp01, mean, round, saturate, terms } from "./util";

// AudienceInsightService — what each audience segment actually cares about, derived from
// the signals attributed to them. Confidence scales with sample size, so a read from three
// signals never presents itself as strongly as one from thirty.

export class AudienceInsightService {
  /** Insights per segment, most confident first. */
  analyze(signals: MarketSignal[]): AudienceInsight[] {
    const bySegment = new Map<string, MarketSignal[]>();
    for (const s of signals) {
      const seg = (s.audience || "").trim();
      if (!seg) continue;
      (bySegment.get(seg) ?? bySegment.set(seg, []).get(seg)!).push(s);
    }

    const out: AudienceInsight[] = [];
    for (const [segment, group] of bySegment) {
      // Affinity = how much of this segment's attention a topic holds.
      const weights = new Map<string, number[]>();
      for (const s of group) {
        for (const t of terms(s.topic)) {
          (weights.get(t) ?? weights.set(t, []).get(t)!).push(s.strength);
        }
      }
      const interests = [...weights.entries()]
        .map(([topic, xs]) => ({ topic, affinity: round(clamp01(mean(xs) * saturate(xs.length, 2))) }))
        .filter((i) => i.affinity > 0)
        .sort((a, b) => b.affinity - a.affinity || a.topic.localeCompare(b.topic))
        .slice(0, 8);

      const activeChannels = [...new Set(group.map((s) => s.source))].sort();

      out.push({
        segment,
        interests,
        activeChannels,
        confidence: round(saturate(group.length, 8)),   // more evidence → more confidence
        sampleSize: group.length,
      });
    }

    return out.sort((a, b) => b.confidence - a.confidence || a.segment.localeCompare(b.segment));
  }

  /** Topics gaining share of a segment's attention versus the previous window. */
  shifts(current: AudienceInsight[], previous: AudienceInsight[], minDelta = 0.15): { segment: string; topic: string; delta: number }[] {
    const prev = new Map<string, Map<string, number>>();
    for (const p of previous) {
      prev.set(p.segment, new Map(p.interests.map((i) => [i.topic, i.affinity])));
    }
    const out: { segment: string; topic: string; delta: number }[] = [];
    for (const c of current) {
      const before = prev.get(c.segment);
      if (!before) continue;
      for (const i of c.interests) {
        const was = before.get(i.topic) ?? 0;
        const delta = round(i.affinity - was);
        if (delta >= minDelta) out.push({ segment: c.segment, topic: i.topic, delta });
      }
    }
    return out.sort((a, b) => b.delta - a.delta || a.topic.localeCompare(b.topic));
  }
}
