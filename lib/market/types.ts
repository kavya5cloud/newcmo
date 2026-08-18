// Market Intelligence — types. Populr discovers opportunities instead of only reporting
// analytics. Provider specifics live ONLY in source adapters (lib/market/sources); every
// core service consumes the normalized MarketSignal below.
//
// Additive to Milestone 12: nothing here touches Publishing/OAuth/Scheduler/Queue/Asset/
// Webhook/Draft/Integration.

// ---- Sources + signals ----

export const MARKET_SOURCES = [
  "google_trends", "reddit", "news", "rss", "competitor_web", "social", "analytics",
] as const;
export type MarketSourceId = (typeof MARKET_SOURCES)[number];

export const SIGNAL_KINDS = [
  "trend", "discussion", "article", "competitor_post", "keyword", "engagement",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** The single normalized unit every source produces. Core services see only this. */
export type MarketSignal = {
  id: string;
  source: MarketSourceId;
  kind: SignalKind;
  /** Normalized topic/keyword this signal is about (lowercased, trimmed). */
  topic: string;
  title: string;
  url?: string;
  /** 0..1 — how loud the signal is (volume/engagement, normalized by the adapter). */
  strength: number;
  /** 0..1 — how fast it is growing. */
  velocity: number;
  audience?: string;
  competitor?: string;
  observedAt: number;
  raw: Record<string, unknown>;
};

export type MarketQuery = {
  tenant: string;
  /** Seed terms — brand, product, category. */
  terms: string[];
  competitors?: string[];
  industry?: string;
  audience?: string;
  /** Only collect signals newer than this (incremental refresh). */
  since?: number;
  limit?: number;
};

export type SourceHealth = { source: MarketSourceId; healthy: boolean; detail?: string };

export type SourceCapabilities = {
  id: MarketSourceId;
  label: string;
  kinds: SignalKind[];
  /** Requests per minute this source tolerates. */
  rateLimitPerMin: number;
  /** Whether it supports `since` for incremental refresh. */
  incremental: boolean;
};

/** A market data source. Interchangeable — real providers implement the same interface. */
export interface MarketSource {
  readonly id: MarketSourceId;
  capabilities(): SourceCapabilities;
  collect(query: MarketQuery): Promise<MarketSignal[]>;
  health(): Promise<SourceHealth>;
}

// ---- Trends ----

export const TREND_KINDS = ["topic", "hashtag", "industry", "viral", "emerging", "seasonal"] as const;
export type TrendKind = (typeof TREND_KINDS)[number];

export type Trend = {
  id: string;
  topic: string;
  kind: TrendKind;
  /** 0..1 aggregate signal strength. */
  strength: number;
  /** 0..1 growth velocity. */
  velocity: number;
  /** 0..1 — rises with corroboration across independent sources. */
  confidence: number;
  sources: MarketSourceId[];
  signalCount: number;
  firstSeen: number;
  lastSeen: number;
  sampleTitles: string[];
};

// ---- Competitors ----

export type EngagementTrend = "rising" | "flat" | "falling";

export type CompetitorProfile = {
  name: string;
  postingFrequencyPerWeek: number;
  engagementTrend: EngagementTrend;
  avgEngagement: number;
  growthRate: number;                                  // -1..1
  contentCategories: { category: string; share: number }[];
  topPosts: { title: string; engagement: number; url?: string }[];
  campaignPatterns: string[];
  summary: string;
  observedFrom: number;
  observedTo: number;
  postCount: number;
};

// ---- Keywords ----

export type KeywordInsight = {
  keyword: string;
  /** Relative monthly volume (normalized, never invented absolutes). */
  volume: number;
  /** 0..1 — how hard it looks to win. */
  difficulty: number;
  /** 0..1 — composite opportunity score. */
  opportunity: number;
  trendHistory: { at: number; volume: number }[];
  cluster: string;
  contentSuggestions: string[];
};

export type KeywordCluster = { name: string; keywords: string[]; opportunity: number };

// ---- Audience ----

export type AudienceInsight = {
  segment: string;
  interests: { topic: string; affinity: number }[];
  activeChannels: string[];
  /** 0..1 how confident we are in this segment read. */
  confidence: number;
  sampleSize: number;
};

// ---- Opportunities ----

export const OPPORTUNITY_KINDS = [
  "rising_trend", "competitor_gap", "keyword_opportunity", "seasonal_window",
  "audience_shift", "viral_moment", "emerging_risk",
] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

export type Tier = "low" | "medium" | "high";

export type Opportunity = {
  id: string;
  kind: OpportunityKind;
  title: string;
  confidence: number;          // 0..1
  expectedImpact: Tier;
  reasoning: string;
  recommendedAction: string;
  suggestedCampaign: string;
  urgency: Tier;
  /** Concrete facts this was derived from — never invented. */
  evidence: string[];
  score: number;               // 0..1 ranking score
  createdAt: number;
};

// ---- Market graph (extends the canonical BusinessGraph) ----

export const MARKET_ENTITY_TYPES = [
  "brand", "product", "service", "audience", "competitor",
  "campaign", "post", "keyword", "analytics", "integration", "trend",
] as const;
export type MarketEntityType = (typeof MARKET_ENTITY_TYPES)[number];

export type MarketEntity = { id: string; type: MarketEntityType; label: string; weight: number };

export const MARKET_RELATIONS = [
  "targets", "competes_with", "ranks_for", "published_as", "measured_by",
  "sourced_from", "interested_in", "belongs_to", "trending_in",
] as const;
export type MarketRelation = (typeof MARKET_RELATIONS)[number];

export type MarketEdge = { from: string; to: string; type: MarketRelation; weight: number };

export type MarketGraph = {
  tenant: string;
  version: string;
  entities: MarketEntity[];
  edges: MarketEdge[];
  generatedAt: number;
};

// ---- Market memory ----

export const MEMORY_RECORD_KINDS = [
  "trend", "competitor", "campaign", "audience", "seasonality", "opportunity",
  // What this workspace has already been written for. Kept apart from "campaign", which
  // holds generation metadata, because this is the one kind read back into the prompt as
  // "do not write these again" — and it is only useful if nothing else is mixed into it.
  "content",
] as const;
export type MemoryRecordKind = (typeof MEMORY_RECORD_KINDS)[number];

export type MemoryRecord = {
  id: string;
  tenant: string;
  kind: MemoryRecordKind;
  key: string;
  value: string;
  /** 0..1 — how well this played out (filled in later by the Learning Engine). */
  performance: number | null;
  observedAt: number;
  version: number;
};

// ---- Research ----

export type ResearchBrief = {
  tenant: string;
  generatedAt: number;
  headline: string;
  trends: Trend[];
  opportunities: Opportunity[];
  competitors: CompetitorProfile[];
  keywords: KeywordInsight[];
  risks: string[];
  /** Narrative written by the existing LLM service; null when unavailable (graceful degradation). */
  narrative: string | null;
};

// ---- Typed errors ----

export type MarketErrorReason = "source_unavailable" | "rate_limited" | "invalid_query" | "no_data";

export class MarketError extends Error {
  constructor(message: string, readonly reason: MarketErrorReason, readonly source?: MarketSourceId) {
    super(message);
    this.name = "MarketError";
  }
}

// ---- Pagination ----

export type Page<T> = { items: T[]; total: number; offset: number; limit: number; hasMore: boolean };

export function paginate<T>(all: T[], offset = 0, limit = 25): Page<T> {
  const items = all.slice(offset, offset + limit);
  return { items, total: all.length, offset, limit, hasMore: offset + items.length < all.length };
}
