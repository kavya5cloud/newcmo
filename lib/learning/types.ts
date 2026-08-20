// Learning Engine — types. Deterministic intelligence: performance events in, structured
// intelligence out (patterns, brand DNA, business-graph signals, decision feedback).
// NO LLMs anywhere in this layer. Pure types only.

import type { AssetKind, CreativeChannel } from "@/lib/creative/taxonomy";
import type { PlatformId } from "@/lib/publishing/types";

// ---- Performance ingestion (Part 2): one schema, every platform ----

export const METRIC_KINDS = [
  "views", "reach", "ctr", "watch_time", "conversions", "revenue",
  "shares", "comments", "likes", "bookmarks", "time_on_page", "email_opens", "replies",
] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export type PerformanceEvent = {
  id: string;
  assetKey: string;
  kind?: AssetKind;
  platform: PlatformId;
  campaignId?: string | null;
  missionId?: string | null;
  industry?: string | null;
  audience?: string | null;
  /** Epoch ms the outcome was observed. */
  at: number;
  metrics: Partial<Record<MetricKind, number>>;
};

/** Aggregated performance for one asset across its events. */
export type AssetAggregate = {
  assetKey: string;
  kind?: AssetKind;
  platform: PlatformId;
  campaignId?: string | null;
  audience?: string | null;
  industry?: string | null;
  eventCount: number;
  totals: Partial<Record<MetricKind, number>>;
  /** 0..1 deterministic performance score. */
  score: number;
  /** Best posting hour (0..23) by score, if timestamps present. */
  bestHour: number | null;
};

// ---- Pattern Library (Part 3) ----

export const PATTERN_KINDS = [
  "winning_hook", "winning_story", "winning_cta", "winning_headline", "winning_layout",
  "winning_motion", "winning_ugc_style", "winning_video_structure", "winning_image_style",
  "winning_launch_sequence", "winning_posting_time",
] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

export type Pattern = {
  id: string;
  /**
   * Whose pattern this is.
   *
   * Added because it was missing, and its absence was not cosmetic: learn_patterns had no
   * tenant column, PatternStore.all() returned the global top 500 by performance, and
   * generation-context fed the top 5 into every workspace's prompt under the heading
   * "WHAT HAS PERFORMED BEFORE". One business's asset keys, campaign ids and performance
   * numbers were being shown to another business as its own learning.
   *
   * It is also in the pattern id. Without it, two workspaces with the same asset key
   * collide on one row and blend their performance into a number belonging to neither.
   */
  workspaceKey: string;
  kind: PatternKind;
  label: string;
  value: string;
  confidence: number;    // 0..1
  performance: number;   // 0..1
  industry: string | null;
  audience: string | null;
  campaign: string | null;
  platform: PlatformId | null;
  version: number;
  history: { at: number; performance: number; note?: string }[];
};

// ---- Brand DNA evolution (Part 4) ----

export const BRAND_TRAITS = [
  "tone", "writing_style", "visual_language", "typography",
  "color_usage", "motion_style", "messaging", "brand_vocabulary",
] as const;
export type BrandTrait = (typeof BRAND_TRAITS)[number];

export type BrandTraitValue = { value: string; confidence: number; evidence: number };

export type BrandDNA = {
  workspaceKey: string;
  version: number;
  traits: Record<BrandTrait, BrandTraitValue>;
  updatedAt: number;
};

// ---- Business Graph evolution (Part 6) ----

export const BG_SIGNAL_KINDS = [
  "product", "audience", "channel", "competitor",
  "campaign_history", "mission_history", "performance", "relationship",
] as const;
export type BgSignalKind = (typeof BG_SIGNAL_KINDS)[number];

export type BusinessGraphSignal = {
  id: string;
  workspaceKey: string;
  kind: BgSignalKind;
  key: string;
  value: string;
  confidence: number;
  performance: number;
  version: number;
  at: number;
};

// ---- Decision feedback loop (Part 7) ----

export type DecisionFeedback = {
  id: string;
  decisionId: string;
  channel: string;
  predictedImpact: number;    // 0..1 (planner's expectedImpact)
  predictedConfidence: number;
  actualPerformance: number;  // 0..1 (measured)
  deviation: number;          // |predicted - actual|
  quality: number;            // 1 - deviation
  at: number;
};

export type DecisionAccuracy = {
  samples: number;
  meanQuality: number;        // 0..1
  meanDeviation: number;
  trend: "improving" | "flat" | "declining";
};

// ---- Insights + engine result (Parts 1 & 8) ----

export type InsightKind =
  | "top_pattern" | "winning_hook" | "winning_asset" | "brand_shift"
  | "decision_accuracy" | "channel_signal" | "recommendation";

export type LearningInsight = {
  kind: InsightKind;
  title: string;
  detail: string;
  confidence: number;
  evidence: string[];
};

export type LearningResult = {
  processedEvents: number;
  aggregates: AssetAggregate[];
  patterns: Pattern[];
  memoryUpdates: number;
  brandVersion: number | null;
  signals: BusinessGraphSignal[];
  insights: LearningInsight[];
};

export type LearningContext = {
  workspaceKey: string;
  industry?: string | null;
};
