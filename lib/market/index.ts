// Market Intelligence — Populr discovers opportunities instead of only reporting
// analytics. Provider specifics live only in source adapters; every core service consumes
// the normalized MarketSignal. Strictly additive to Milestone 12.

export * from "./types";
export { createReferenceSources, createSourceRegistry, SourceRegistry, SOURCE_SPECS } from "./sources";
export { SignalAggregator, dedupe, type CollectionResult, type AggregatorOptions } from "./aggregator";
export { TrendService, type TrendOptions } from "./trends";
export { CompetitorService, type CompetitorOptions } from "./competitors";
export { KeywordService, type KeywordOptions } from "./keywords";
export { AudienceInsightService } from "./audience";
export { OpportunityEngine, type OpportunityInput } from "./opportunities";
export { BusinessGraphService, type GraphInput } from "./graph";
export {
  InMemoryMarketMemory, NeonMarketMemory, memoryRecord, remember, seasonality,
  type MarketMemoryStore,
} from "./memory";
export { ResearchService, type ResearchDeps, type ResearchOptions } from "./research";
export { marketPlatform, type MarketPlatform } from "./shared";
