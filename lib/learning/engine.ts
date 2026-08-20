import type { AssetKind } from "@/lib/creative/taxonomy";
import {
  InMemoryCreativeMemoryStore, memoryEntry, type CreativeMemoryStore,
} from "@/lib/creative-intelligence/creative-memory";
import type { MemoryKind } from "@/lib/creative-intelligence/types";
import { aggregatePerformance } from "./performance";
import { extractPatterns, InMemoryPatternStore, type PatternStore } from "./patterns";
import {
  emptyBrandDNA, evolveBrandDNA, InMemoryBrandDNAStore, type BrandDNAStore, type BrandObservation,
} from "./brand-dna";
import { evolveBusinessGraph, InMemoryBgSignalStore, type BgSignalStore } from "./business-graph-evolution";
import { generateInsights } from "./insights";
import type {
  AssetAggregate, BrandTrait, LearningContext, LearningResult, PerformanceEvent,
} from "./types";
import { round } from "./util";

// Learning Engine (Part 1) — the deterministic core. It processes performance events and
// updates ALL the intelligence stores: Pattern Library, Brand DNA, Creative Memory,
// Business Graph signals — then emits insights. No LLM anywhere; identical events always
// produce identical updates. This intelligence becomes the input for future decisions.

const MEMORY_KIND_FOR_ASSET: Partial<Record<AssetKind, MemoryKind>> = {
  hero_video: "video_style", product_demo: "video_style", ugc_video: "video_style",
  motion_graphic: "motion_pattern", landing_hero: "layout", carousel: "layout",
  infographic: "layout", instagram_post: "layout", linkedin_post: "hook",
  x_thread: "hook", reddit_post: "hook", email: "cta", blog: "headline",
  press_release: "headline", advertisement: "headline", sales_deck: "story_structure",
  case_study: "story_structure",
};

const BRAND_TRAIT_FOR_ASSET: Partial<Record<AssetKind, BrandTrait>> = {
  hero_video: "visual_language", product_demo: "visual_language", ugc_video: "tone",
  motion_graphic: "motion_style", landing_hero: "visual_language", carousel: "visual_language",
  infographic: "color_usage", instagram_post: "visual_language", linkedin_post: "writing_style",
  x_thread: "writing_style", reddit_post: "writing_style", email: "messaging",
  blog: "writing_style", press_release: "messaging", advertisement: "messaging",
  sales_deck: "messaging", case_study: "writing_style",
};

const WIN = 0.35; // score at/above which an asset is a "winner"

export type LearningStores = {
  patterns?: PatternStore;
  brand?: BrandDNAStore;
  signals?: BgSignalStore;
  memory?: CreativeMemoryStore;
};

export class LearningEngine {
  readonly patterns: PatternStore;
  readonly brand: BrandDNAStore;
  readonly signals: BgSignalStore;
  readonly memory: CreativeMemoryStore;

  constructor(stores: LearningStores = {}) {
    this.patterns = stores.patterns ?? new InMemoryPatternStore();
    this.brand = stores.brand ?? new InMemoryBrandDNAStore();
    this.signals = stores.signals ?? new InMemoryBgSignalStore();
    this.memory = stores.memory ?? new InMemoryCreativeMemoryStore([]);
  }

  /** Process a batch of performance events and update every intelligence store. */
  async ingest(events: PerformanceEvent[], ctx: LearningContext): Promise<LearningResult> {
    const aggregates = aggregatePerformance(events);

    // 1) Pattern Library
    const extracted = extractPatterns(aggregates, { workspaceKey: ctx.workspaceKey });
    const recordedPatterns = [];
    for (const p of extracted) recordedPatterns.push(await this.patterns.record(p));

    // 2) Creative Memory — winners AND losers (searchable), tagged.
    let memoryUpdates = 0;
    for (const a of aggregates) {
      const memKind = a.kind ? MEMORY_KIND_FOR_ASSET[a.kind] : undefined;
      if (!memKind) continue;
      const winning = a.score >= WIN;
      await this.memory.record(memoryEntry(
        memKind,
        `${a.kind} · ${a.platform}`,
        a.assetKey,
        a.score,
        { audiences: a.audience ? [a.audience] : [], tags: [winning ? "winning" : "underperforming", "learned"] },
      ));
      memoryUpdates++;
    }

    // 3) Brand DNA — evolve from winning assets.
    const observations: BrandObservation[] = aggregates
      .filter((a) => a.score >= WIN && a.kind && BRAND_TRAIT_FOR_ASSET[a.kind])
      .map((a) => ({ trait: BRAND_TRAIT_FOR_ASSET[a.kind!]!, value: `${a.kind} on ${a.platform}`, performance: a.score }));
    let brandVersion: number | null = null;
    if (observations.length) {
      const current = (await this.brand.latest(ctx.workspaceKey)) ?? emptyBrandDNA(ctx.workspaceKey);
      const evolved = evolveBrandDNA(current, observations, events[0]?.at ?? 0);
      await this.brand.save(evolved);
      brandVersion = evolved.version;
    }

    // 4) Business Graph signals
    const sigs = evolveBusinessGraph(ctx.workspaceKey, aggregates);
    const recordedSignals = [];
    for (const s of sigs) recordedSignals.push(await this.signals.record(s));

    // 5) Insights
    const brand = await this.brand.latest(ctx.workspaceKey);
    const insights = generateInsights({ aggregates, patterns: recordedPatterns, brand });

    return {
      processedEvents: events.length,
      aggregates,
      patterns: recordedPatterns,
      memoryUpdates,
      brandVersion,
      signals: recordedSignals,
      insights,
    };
  }

  /** Summary numbers for the dashboard. */
  async snapshot(workspaceKey: string) {
    const patterns = await this.patterns.all(workspaceKey);
    const brand = await this.brand.latest(workspaceKey);
    const signals = await this.signals.list(workspaceKey);
    return {
      patternCount: patterns.length,
      topPattern: patterns.sort((a, b) => b.performance - a.performance)[0] ?? null,
      brandVersion: brand?.version ?? 0,
      signalCount: signals.length,
      avgPatternPerformance: patterns.length ? round(patterns.reduce((s, p) => s + p.performance, 0) / patterns.length) : 0,
    };
  }
}
