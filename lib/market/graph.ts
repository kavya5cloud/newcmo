import { createHash } from "node:crypto";
import type { BusinessGraph } from "@/lib/business-graph";
import type {
  CompetitorProfile, KeywordInsight, MarketEdge, MarketEntity, MarketGraph, Trend,
  AudienceInsight,
} from "./types";
import { clamp01, round } from "./util";

// BusinessGraphService — the market view of the business graph. It EXTENDS the canonical
// projection from lib/business-graph.ts rather than replacing it: that module stays the
// source of truth for business/goal/mission/campaign state, and this layer adds the market
// entities (products, audiences, competitors, keywords, trends, integrations) plus the
// relationships between them. Future agents consume this one graph instead of isolated
// records.

export type GraphInput = {
  tenant: string;
  brand: string;
  /** The canonical projection, when available — its entities are merged in. */
  base?: BusinessGraph | null;
  products?: string[];
  services?: string[];
  audiences?: AudienceInsight[];
  competitors?: CompetitorProfile[];
  keywords?: KeywordInsight[];
  trends?: Trend[];
  integrations?: string[];
  now?: number;
};

const ID = {
  brand: (s: string) => `brand:${s}`,
  product: (s: string) => `product:${s}`,
  service: (s: string) => `service:${s}`,
  audience: (s: string) => `audience:${s}`,
  competitor: (s: string) => `competitor:${s}`,
  keyword: (s: string) => `keyword:${s}`,
  trend: (s: string) => `trend:${s}`,
  integration: (s: string) => `integration:${s}`,
  campaign: (s: string) => `campaign:${s}`,
  analytics: (s: string) => `analytics:${s}`,
};

export class BusinessGraphService {
  /** Build the merged market graph. Deterministic — same input, same version hash. */
  build(input: GraphInput): MarketGraph {
    const entities: MarketEntity[] = [];
    const edges: MarketEdge[] = [];
    const seen = new Set<string>();

    const addEntity = (e: MarketEntity) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      entities.push(e);
    };
    const addEdge = (from: string, to: string, type: MarketEdge["type"], weight: number) => {
      edges.push({ from, to, type, weight: round(clamp01(weight)) });
    };

    const brandId = ID.brand(input.brand);
    addEntity({ id: brandId, type: "brand", label: input.brand, weight: 1 });

    // Merge the canonical projection: campaigns/missions already known to the business.
    for (const be of input.base?.entities ?? []) {
      if (be.type === "campaign" || be.type === "mission") {
        const id = ID.campaign(be.label);
        addEntity({ id, type: "campaign", label: be.label, weight: 0.6 });
        addEdge(brandId, id, "belongs_to", 0.6);
      }
      if (be.type === "channel") {
        const id = ID.analytics(be.label);
        addEntity({ id, type: "analytics", label: be.label, weight: 0.5 });
        addEdge(brandId, id, "measured_by", 0.5);
      }
    }

    for (const p of input.products ?? []) {
      const id = ID.product(p);
      addEntity({ id, type: "product", label: p, weight: 0.9 });
      addEdge(brandId, id, "belongs_to", 0.9);
    }
    for (const s of input.services ?? []) {
      const id = ID.service(s);
      addEntity({ id, type: "service", label: s, weight: 0.8 });
      addEdge(brandId, id, "belongs_to", 0.8);
    }

    for (const a of input.audiences ?? []) {
      const id = ID.audience(a.segment);
      addEntity({ id, type: "audience", label: a.segment, weight: a.confidence });
      addEdge(brandId, id, "targets", a.confidence);
      for (const i of a.interests.slice(0, 4)) {
        const kid = ID.keyword(i.topic);
        addEntity({ id: kid, type: "keyword", label: i.topic, weight: i.affinity });
        addEdge(id, kid, "interested_in", i.affinity);
      }
    }

    for (const c of input.competitors ?? []) {
      const id = ID.competitor(c.name);
      addEntity({ id, type: "competitor", label: c.name, weight: clamp01(c.avgEngagement) });
      addEdge(brandId, id, "competes_with", clamp01(c.avgEngagement));
      for (const cat of c.contentCategories.slice(0, 3)) {
        const kid = ID.keyword(cat.category);
        addEntity({ id: kid, type: "keyword", label: cat.category, weight: cat.share });
        addEdge(id, kid, "ranks_for", cat.share);
      }
    }

    for (const k of input.keywords ?? []) {
      const id = ID.keyword(k.keyword);
      addEntity({ id, type: "keyword", label: k.keyword, weight: k.opportunity });
      addEdge(brandId, id, "ranks_for", k.opportunity);
    }

    for (const t of input.trends ?? []) {
      const id = ID.trend(t.topic);
      addEntity({ id, type: "trend", label: t.topic, weight: t.confidence });
      addEdge(id, brandId, "trending_in", t.confidence);
      for (const src of t.sources) {
        const sid = ID.integration(src);
        addEntity({ id: sid, type: "integration", label: src, weight: 0.5 });
        addEdge(id, sid, "sourced_from", 0.5);
      }
    }

    for (const i of input.integrations ?? []) {
      const id = ID.integration(i);
      addEntity({ id, type: "integration", label: i, weight: 0.6 });
      addEdge(brandId, id, "measured_by", 0.6);
    }

    // Deterministic content hash — the same market state always yields the same version.
    const version = createHash("sha256")
      .update(JSON.stringify({ entities, edges }))
      .digest("hex")
      .slice(0, 16);

    return {
      tenant: input.tenant,
      version,
      entities: entities.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)),
      edges: dedupeEdges(edges),
      generatedAt: input.now ?? Date.now(),
    };
  }

  /** Everything directly connected to a node — the neighbourhood an agent needs. */
  neighbours(graph: MarketGraph, id: string): { entity: MarketEntity; edge: MarketEdge }[] {
    const byId = new Map(graph.entities.map((e) => [e.id, e]));
    const out: { entity: MarketEntity; edge: MarketEdge }[] = [];
    for (const e of graph.edges) {
      if (e.from === id && byId.has(e.to)) out.push({ entity: byId.get(e.to)!, edge: e });
      else if (e.to === id && byId.has(e.from)) out.push({ entity: byId.get(e.from)!, edge: e });
    }
    return out.sort((a, b) => b.edge.weight - a.edge.weight || a.entity.id.localeCompare(b.entity.id));
  }

  /** Entities of one type, heaviest first. */
  byType(graph: MarketGraph, type: MarketEntity["type"]): MarketEntity[] {
    return graph.entities.filter((e) => e.type === type);
  }
}

function dedupeEdges(edges: MarketEdge[]): MarketEdge[] {
  const best = new Map<string, MarketEdge>();
  for (const e of edges) {
    const k = `${e.from}|${e.to}|${e.type}`;
    const cur = best.get(k);
    if (!cur || e.weight > cur.weight) best.set(k, e);
  }
  return [...best.values()].sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}
