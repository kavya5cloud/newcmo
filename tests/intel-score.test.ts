import { describe, it, expect } from "vitest";
import {
  computeDelta,
  associationScore,
  scoreConfidence,
  type SnapshotMetrics,
} from "../lib/intel-score";

const snap = (impressions: number, clicks: number, ctr: number, position: number): SnapshotMetrics => ({
  impressions, clicks, ctr, position,
});

describe("computeDelta", () => {
  it("computes percent changes and position change", () => {
    const d = computeDelta(snap(1000, 50, 0.05, 12), snap(1500, 100, 0.0667, 8));
    expect(d.impressions.pct).toBeCloseTo(0.5);
    expect(d.clicks.pct).toBeCloseTo(1.0);
    expect(d.position.change).toBeCloseTo(-4); // improved by 4 ranks
  });

  it("handles zero baselines without dividing by zero", () => {
    const d = computeDelta(snap(0, 0, 0, 0), snap(100, 10, 0.1, 20));
    expect(d.impressions.pct).toBe(1);
    expect(d.clicks.pct).toBe(1);
    expect(Number.isFinite(d.ctr.pct)).toBe(true);
  });

  it("is zero for identical snapshots", () => {
    const d = computeDelta(snap(500, 20, 0.04, 10), snap(500, 20, 0.04, 10));
    expect(d.impressions.pct).toBe(0);
    expect(d.clicks.pct).toBe(0);
    expect(d.position.change).toBe(0);
  });
});

describe("associationScore", () => {
  it("returns 0.5 for no movement", () => {
    const d = computeDelta(snap(500, 20, 0.04, 10), snap(500, 20, 0.04, 10));
    expect(associationScore(d)).toBeCloseTo(0.5);
  });

  it("scores improvement above 0.5 and decline below 0.5", () => {
    const up = computeDelta(snap(1000, 50, 0.05, 12), snap(1600, 110, 0.069, 7));
    const down = computeDelta(snap(1000, 50, 0.05, 12), snap(600, 20, 0.033, 18));
    expect(associationScore(up)).toBeGreaterThan(0.5);
    expect(associationScore(down)).toBeLessThan(0.5);
  });

  it("stays within [0, 1] even for extreme swings", () => {
    const boom = computeDelta(snap(10, 1, 0.1, 50), snap(100000, 9000, 0.09, 1));
    const bust = computeDelta(snap(100000, 9000, 0.09, 1), snap(1, 0, 0, 90));
    expect(associationScore(boom)).toBeLessThanOrEqual(1);
    expect(associationScore(boom)).toBeGreaterThan(0.5);
    expect(associationScore(bust)).toBeGreaterThanOrEqual(0);
    expect(associationScore(bust)).toBeLessThan(0.5);
  });

  it("weights clicks more than impressions", () => {
    const clicksUp = computeDelta(snap(1000, 50, 0.05, 10), snap(1000, 100, 0.1, 10));
    const imprUp = computeDelta(snap(1000, 50, 0.05, 10), snap(2000, 50, 0.025, 10));
    // Pure click doubling should beat pure impression doubling (which also halves CTR).
    expect(associationScore(clicksUp)).toBeGreaterThan(associationScore(imprUp));
  });
});

describe("scoreConfidence", () => {
  it("is 0 with no data", () => {
    expect(scoreConfidence(0, 0)).toBe(0);
  });
  it("is low for tiny sites and high for large ones", () => {
    expect(scoreConfidence(50, 50)).toBeLessThan(0.1);
    expect(scoreConfidence(500, 500)).toBeCloseTo(0.5, 1);
    expect(scoreConfidence(10000, 10000)).toBe(1);
  });
  it("is monotonic in volume", () => {
    const a = scoreConfidence(100, 100);
    const b = scoreConfidence(1000, 1000);
    const c = scoreConfidence(5000, 5000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThanOrEqual(b);
  });
});
