import { describe, it, expect } from "vitest";
import { createSourceRegistry, SourceRegistry } from "@/lib/market/sources";
import { SignalAggregator, dedupe } from "@/lib/market/aggregator";
import { TrendService } from "@/lib/market/trends";
import { CompetitorService } from "@/lib/market/competitors";
import { KeywordService } from "@/lib/market/keywords";
import { AudienceInsightService } from "@/lib/market/audience";
import { OpportunityEngine } from "@/lib/market/opportunities";
import { BusinessGraphService } from "@/lib/market/graph";
import { InMemoryMarketMemory, memoryRecord, remember, seasonality } from "@/lib/market/memory";
import { ResearchService } from "@/lib/market/research";
import {
  MARKET_SOURCES, MarketError, paginate,
  type MarketQuery, type MarketSignal, type MarketSource, type SourceHealth,
} from "@/lib/market/types";
import { DAY_MS } from "@/lib/market/util";

const T0 = 1_800_000_000_000;
const fixedNow = () => T0;
const QUERY: MarketQuery = {
  tenant: "t1", terms: ["ai cmo", "marketing automation"],
  competitors: ["Okara", "Rival"], industry: "saas", audience: "founders", limit: 6,
};

function sig(over: Partial<MarketSignal> = {}): MarketSignal {
  return {
    id: over.id ?? `s${Math.random()}`, source: "reddit", kind: "discussion",
    topic: "ai compliance", title: "Discussion: ai compliance", strength: 0.6, velocity: 0.7,
    observedAt: T0, raw: {}, ...over,
  };
}

describe("Source adapters", () => {
  it("registers every source with capabilities + health", async () => {
    const reg = createSourceRegistry(fixedNow);
    expect(reg.ids().sort()).toEqual([...MARKET_SOURCES].sort());
    expect(reg.capabilities().every((c) => c.rateLimitPerMin > 0)).toBe(true);
    expect((await reg.health()).every((h: SourceHealth) => h.healthy)).toBe(true);
  });

  it("collects deterministic normalized signals", async () => {
    const a = await createSourceRegistry(fixedNow).get("google_trends")!.collect(QUERY);
    const b = await createSourceRegistry(fixedNow).get("google_trends")!.collect(QUERY);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const s of a) {
      expect(s.strength).toBeGreaterThanOrEqual(0);
      expect(s.strength).toBeLessThanOrEqual(1);
      expect(s.velocity).toBeGreaterThanOrEqual(0);
      expect(s.velocity).toBeLessThanOrEqual(1);
      expect(s.topic).toBe(s.topic.toLowerCase().trim());
    }
  });

  it("honours `since` for incremental refresh", async () => {
    const src = createSourceRegistry(fixedNow).get("news")!;
    const all = await src.collect(QUERY);
    const recent = await src.collect({ ...QUERY, since: T0 - 2 * DAY_MS });
    expect(recent.length).toBeLessThanOrEqual(all.length);
    expect(recent.every((s) => s.observedAt >= T0 - 2 * DAY_MS)).toBe(true);
  });
});

describe("SignalAggregator", () => {
  it("collects across sources, dedupes and reports which succeeded", async () => {
    const agg = new SignalAggregator(createSourceRegistry(fixedNow), { now: fixedNow });
    const res = await agg.collect(QUERY);
    expect(res.signals.length).toBeGreaterThan(0);
    expect(res.ok.length).toBe(MARKET_SOURCES.length);
    expect(res.failed.length).toBe(0);
    // no duplicate (source, topic) pairs survive
    const keys = res.signals.map((s) => `${s.source}:${s.topic}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("degrades gracefully — one dead source never fails the run", async () => {
    const reg = new SourceRegistry();
    for (const s of createSourceRegistry(fixedNow).list()) reg.register(s);
    const broken: MarketSource = {
      id: "news",
      capabilities: () => ({ id: "news", label: "News", kinds: ["article"], rateLimitPerMin: 5, incremental: true }),
      collect: async () => { throw new Error("upstream 500"); },
      health: async () => ({ source: "news", healthy: false }),
    };
    reg.register(broken); // replaces the working news adapter

    const agg = new SignalAggregator(reg, { now: fixedNow, maxRetries: 1 });
    const res = await agg.collect(QUERY);
    expect(res.failed.map((f) => f.source)).toContain("news");
    expect(res.signals.length).toBeGreaterThan(0);   // still shipped intelligence
  });

  it("caches repeat queries", async () => {
    const agg = new SignalAggregator(createSourceRegistry(fixedNow), { now: fixedNow });
    await agg.collect(QUERY);
    const second = await agg.collect(QUERY);
    expect(second.cached.length).toBeGreaterThan(0);
  });

  it("rejects an empty query with a typed error", async () => {
    const agg = new SignalAggregator(createSourceRegistry(fixedNow), { now: fixedNow });
    await expect(agg.collect({ tenant: "t", terms: [] })).rejects.toBeInstanceOf(MarketError);
  });

  it("dedupe keeps the strongest signal per source+topic", () => {
    const out = dedupe([sig({ id: "a", strength: 0.3 }), sig({ id: "b", strength: 0.9 })]);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("b");
  });
});

describe("TrendService", () => {
  const svc = new TrendService({ now: fixedNow });

  it("rewards corroboration across independent sources", () => {
    const single = svc.detect([sig({ source: "reddit", topic: "solo topic" }), sig({ source: "reddit", topic: "solo topic", id: "x" })]);
    const multi = svc.detect([
      sig({ source: "reddit", topic: "shared topic" }),
      sig({ source: "news", topic: "shared topic", id: "n" }),
      sig({ source: "google_trends", topic: "shared topic", id: "g" }),
    ]);
    expect(multi[0].confidence).toBeGreaterThan(single[0].confidence);
    expect(multi[0].sources.length).toBe(3);
  });

  it("classifies viral vs ordinary topics", () => {
    const [viral] = svc.detect([sig({ topic: "explosive", strength: 0.9, velocity: 0.95 })]);
    expect(viral.kind).toBe("viral");
    const [seasonal] = svc.detect([sig({ topic: "black friday deals", strength: 0.5, velocity: 0.4 })]);
    expect(seasonal.kind).toBe("seasonal");
  });

  it("ranks and filters rising trends deterministically", () => {
    const signals = [sig({ topic: "a", velocity: 0.9 }), sig({ topic: "b", velocity: 0.2, id: "b" })];
    const trends = svc.detect(signals);
    expect(svc.rising(trends).map((t) => t.topic)).toEqual(["a"]);
    expect(JSON.stringify(svc.detect(signals))).toBe(JSON.stringify(svc.detect(signals)));
  });
});

describe("CompetitorService", () => {
  const svc = new CompetitorService({ now: fixedNow });
  const posts: MarketSignal[] = [
    sig({ id: "c1", competitor: "Okara", kind: "competitor_post", title: "Okara — pricing update", topic: "pricing", strength: 0.3, observedAt: T0 - 20 * DAY_MS }),
    sig({ id: "c2", competitor: "Okara", kind: "competitor_post", title: "Okara — case study with Acme", topic: "case study", strength: 0.4, observedAt: T0 - 14 * DAY_MS }),
    sig({ id: "c3", competitor: "Okara", kind: "competitor_post", title: "Okara — new feature release", topic: "product", strength: 0.8, observedAt: T0 - 3 * DAY_MS }),
    sig({ id: "c4", competitor: "Okara", kind: "competitor_post", title: "Okara — customer story", topic: "customer", strength: 0.9, observedAt: T0 - 1 * DAY_MS }),
  ];

  it("computes frequency, engagement trend and content mix from evidence", () => {
    const p = svc.profile("Okara", posts);
    expect(p.postCount).toBe(4);
    expect(p.postingFrequencyPerWeek).toBeGreaterThan(0);
    expect(p.engagementTrend).toBe("rising");   // later posts are stronger
    expect(p.contentCategories.length).toBeGreaterThan(0);
    expect(p.topPosts[0].engagement).toBeGreaterThanOrEqual(p.topPosts[1]?.engagement ?? 0);
    expect(p.summary).toContain("Okara");
  });

  it("says so honestly when there is no data", () => {
    const p = svc.profile("Ghost", posts);
    expect(p.postCount).toBe(0);
    expect(p.summary).toMatch(/No observed activity/);
  });

  it("finds content gaps we do not cover", () => {
    const gaps = svc.contentGaps(
      [...posts, sig({ id: "c5", competitor: "Okara", kind: "competitor_post", topic: "compliance audit", title: "Okara — compliance audit" })],
      ["pricing"],
    );
    expect(Array.isArray(gaps)).toBe(true);
  });
});

describe("KeywordService", () => {
  const svc = new KeywordService({ now: fixedNow });
  const signals = [
    sig({ id: "k1", topic: "ai compliance software", source: "google_trends", strength: 0.4, velocity: 0.9 }),
    sig({ id: "k2", topic: "ai compliance checklist", source: "reddit", strength: 0.3, velocity: 0.8 }),
    sig({ id: "k3", topic: "ai compliance software", source: "news", strength: 0.5, velocity: 0.7 }),
  ];

  it("discovers, scores and clusters keywords", () => {
    const ks = svc.discover(signals);
    expect(ks.length).toBeGreaterThan(0);
    for (const k of ks) {
      expect(k.opportunity).toBeGreaterThanOrEqual(0);
      expect(k.opportunity).toBeLessThanOrEqual(1);
      expect(k.contentSuggestions.length).toBeGreaterThan(0);
    }
    expect(svc.cluster(ks).length).toBeGreaterThan(0);
  });

  it("favours winnable demand — low difficulty beats a crowded term", () => {
    const easy = svc.discover([
      sig({ id: "e1", topic: "niche term here", source: "reddit", strength: 0.2, velocity: 0.9 }),
      sig({ id: "e2", topic: "niche term here", source: "reddit", strength: 0.2, velocity: 0.9 }),
    ]);
    const crowded = svc.discover([
      sig({ id: "h1", topic: "crowded term here", source: "reddit", strength: 0.95, velocity: 0.2 }),
      sig({ id: "h2", topic: "crowded term here", source: "news", strength: 0.95, velocity: 0.2 }),
      sig({ id: "h3", topic: "crowded term here", source: "google_trends", strength: 0.95, velocity: 0.2 }),
    ]);
    expect(easy[0].difficulty).toBeLessThan(crowded[0].difficulty);
  });

  it("builds trend history ordered in time", () => {
    const [k] = svc.discover(signals);
    const ats = k.trendHistory.map((h) => h.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
  });
});

describe("AudienceInsightService", () => {
  it("scales confidence with sample size", () => {
    const svc = new AudienceInsightService();
    const few = svc.analyze([sig({ audience: "founders", topic: "pricing" })]);
    const many = svc.analyze(Array.from({ length: 20 }, (_, i) => sig({ id: `m${i}`, audience: "founders", topic: "pricing" })));
    expect(many[0].confidence).toBeGreaterThan(few[0].confidence);
  });

  it("detects interest shifts between windows", () => {
    const svc = new AudienceInsightService();
    const before = svc.analyze([sig({ audience: "founders", topic: "pricing", strength: 0.2 })]);
    const after = svc.analyze(Array.from({ length: 10 }, (_, i) => sig({ id: `a${i}`, audience: "founders", topic: "pricing", strength: 0.95 })));
    expect(svc.shifts(after, before).length).toBeGreaterThan(0);
  });
});

describe("OpportunityEngine", () => {
  const engine = new OpportunityEngine();
  const trends = new TrendService({ now: fixedNow }).detect([
    sig({ id: "t1", topic: "ai compliance", source: "news", strength: 0.8, velocity: 0.9 }),
    sig({ id: "t2", topic: "ai compliance", source: "reddit", strength: 0.7, velocity: 0.85 }),
    sig({ id: "t3", topic: "ai compliance", source: "google_trends", strength: 0.9, velocity: 0.95 }),
  ]);

  it("produces complete, evidence-backed cards", () => {
    const opps = engine.generate({ trends, competitors: [], keywords: [], now: T0 });
    expect(opps.length).toBeGreaterThan(0);
    for (const o of opps) {
      expect(o.title).toBeTruthy();
      expect(o.reasoning).toBeTruthy();
      expect(o.recommendedAction).toBeTruthy();
      expect(o.suggestedCampaign).toBeTruthy();
      expect(o.evidence.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(o.expectedImpact);
      expect(["low", "medium", "high"]).toContain(o.urgency);
      expect(o.confidence).toBeGreaterThanOrEqual(0);
      expect(o.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("flags a competitor slowdown as an opening", () => {
    const svc = new CompetitorService({ now: fixedNow });
    const quiet = svc.profile("Okara", [
      sig({ id: "q1", competitor: "Okara", kind: "competitor_post", strength: 0.9, observedAt: T0 - 60 * DAY_MS, title: "Okara — old post" }),
      sig({ id: "q2", competitor: "Okara", kind: "competitor_post", strength: 0.1, observedAt: T0 - 2 * DAY_MS, title: "Okara — recent post" }),
    ]);
    const opps = engine.generate({ trends: [], competitors: [quiet], keywords: [], now: T0 });
    expect(opps.some((o) => o.kind === "competitor_gap")).toBe(true);
  });

  it("ranks by score and is deterministic", () => {
    const a = engine.generate({ trends, competitors: [], keywords: [], now: T0 });
    const b = engine.generate({ trends, competitors: [], keywords: [], now: T0 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (let i = 1; i < a.length; i++) expect(a[i - 1].score).toBeGreaterThanOrEqual(a[i].score);
  });
});

describe("BusinessGraphService", () => {
  const svc = new BusinessGraphService();

  it("links brand → products, audiences, competitors, keywords and trends", () => {
    const g = svc.build({
      tenant: "t1", brand: "Populr",
      products: ["AI CMO"],
      audiences: [{ segment: "founders", interests: [{ topic: "pricing", affinity: 0.8 }], activeChannels: ["reddit"], confidence: 0.7, sampleSize: 9 }],
      competitors: [{ name: "Okara", postingFrequencyPerWeek: 2, engagementTrend: "flat", avgEngagement: 0.5, growthRate: 0, contentCategories: [{ category: "pricing", share: 0.5 }], topPosts: [], campaignPatterns: [], summary: "", observedFrom: T0, observedTo: T0, postCount: 3 }],
      keywords: [{ keyword: "ai cmo", volume: 0.6, difficulty: 0.3, opportunity: 0.8, trendHistory: [], cluster: "ai", contentSuggestions: [] }],
      trends: [{ id: "x", topic: "ai compliance", kind: "topic", strength: 0.7, velocity: 0.8, confidence: 0.75, sources: ["news"], signalCount: 3, firstSeen: T0, lastSeen: T0, sampleTitles: [] }],
      now: T0,
    });
    const types = new Set(g.entities.map((e) => e.type));
    expect(types.has("brand")).toBe(true);
    expect(types.has("product")).toBe(true);
    expect(types.has("audience")).toBe(true);
    expect(types.has("competitor")).toBe(true);
    expect(types.has("keyword")).toBe(true);
    expect(types.has("trend")).toBe(true);
    expect(g.edges.some((e) => e.type === "competes_with")).toBe(true);
    expect(svc.neighbours(g, "brand:Populr").length).toBeGreaterThan(0);
  });

  it("version is a stable content hash", () => {
    const input = { tenant: "t1", brand: "Populr", products: ["A"], now: T0 };
    expect(svc.build(input).version).toBe(svc.build(input).version);
    expect(svc.build({ ...input, products: ["B"] }).version).not.toBe(svc.build(input).version);
  });
});

describe("MarketMemory", () => {
  it("records, versions and reads history", async () => {
    const mem = new InMemoryMarketMemory();
    const r = memoryRecord("t1", "trend", "ai compliance", "strong", T0, 0.8);
    await mem.record(r);
    const again = await mem.record(r);
    expect(again.version).toBe(2);                 // re-observation versions, never loses
    expect((await mem.list("t1", "trend")).length).toBe(1);
    expect((await mem.history("t1", "ai compliance")).length).toBe(1);
  });

  it("persists a whole run and computes seasonality", async () => {
    const mem = new InMemoryMarketMemory();
    const n = await remember(mem, "t1", T0, {
      trends: [{ id: "t", topic: "x", kind: "topic", strength: 0.5, velocity: 0.5, confidence: 0.6, sources: ["news"], signalCount: 2, firstSeen: T0, lastSeen: T0, sampleTitles: [] }],
      opportunities: [],
    });
    expect(n).toBe(1);
    const hist = [
      memoryRecord("t1", "trend", "x", "v", Date.UTC(2026, 0, 5), 0.9),
      memoryRecord("t1", "trend", "x", "v", Date.UTC(2026, 6, 5), 0.2),
    ];
    expect(seasonality(hist)[0].strength).toBe(0.9);
  });
});

describe("ResearchService (end to end, no LLM)", () => {
  it("runs a full pass and returns a complete brief", async () => {
    const agg = new SignalAggregator(createSourceRegistry(fixedNow), { now: fixedNow });
    const brief = await new ResearchService({ aggregator: agg, now: fixedNow }).run(QUERY);
    expect(brief.tenant).toBe("t1");
    expect(brief.headline).toBeTruthy();
    expect(brief.trends.length).toBeGreaterThan(0);
    expect(brief.opportunities.length).toBeGreaterThan(0);
    expect(brief.competitors.length).toBe(2);
    expect(brief.narrative).toBeNull();          // no LLM requested
  });

  it("is deterministic", async () => {
    const run = async () => {
      const agg = new SignalAggregator(createSourceRegistry(fixedNow), { now: fixedNow });
      return new ResearchService({ aggregator: agg, now: fixedNow }).run(QUERY);
    };
    expect(JSON.stringify(await run())).toBe(JSON.stringify(await run()));
  });
});

describe("Pagination", () => {
  it("pages correctly", () => {
    const p = paginate([1, 2, 3, 4, 5], 2, 2);
    expect(p.items).toEqual([3, 4]);
    expect(p.total).toBe(5);
    expect(p.hasMore).toBe(true);
    expect(paginate([1, 2], 0, 10).hasMore).toBe(false);
  });
});
