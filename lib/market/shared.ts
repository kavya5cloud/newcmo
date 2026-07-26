import { db } from "@/lib/db";
import { createSourceRegistry, SourceRegistry } from "./sources";
import { SignalAggregator } from "./aggregator";
import { ResearchService } from "./research";
import { BusinessGraphService } from "./graph";
import { OpportunityEngine } from "./opportunities";
import { InMemoryMarketMemory, NeonMarketMemory, type MarketMemoryStore } from "./memory";

// Shared market platform for the API routes: one registry + aggregator (so its cache and
// rate-limit windows are process-wide) + services. Memory persists to Neon when a database
// is configured, in-memory otherwise.

export type MarketPlatform = {
  registry: SourceRegistry;
  aggregator: SignalAggregator;
  research: ResearchService;
  graph: BusinessGraphService;
  opportunities: OpportunityEngine;
  memory: MarketMemoryStore;
};

let platform: MarketPlatform | null = null;

export function marketPlatform(): MarketPlatform {
  if (!platform) {
    const registry = createSourceRegistry(Date.now);
    const aggregator = new SignalAggregator(registry, { now: Date.now });
    const sql = db();
    platform = {
      registry,
      aggregator,
      research: new ResearchService({ aggregator, now: Date.now }),
      graph: new BusinessGraphService(),
      opportunities: new OpportunityEngine(),
      memory: sql ? new NeonMarketMemory(sql) : new InMemoryMarketMemory(),
    };
  }
  return platform;
}
