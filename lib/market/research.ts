import { generateText } from "@/lib/services/llm";
import { extractJson } from "@/lib/llm-json";
import type { SignalAggregator } from "./aggregator";
import { TrendService } from "./trends";
import { CompetitorService } from "./competitors";
import { KeywordService } from "./keywords";
import { AudienceInsightService } from "./audience";
import { OpportunityEngine } from "./opportunities";
import type { MarketQuery, ResearchBrief, Opportunity, Trend, CompetitorProfile, KeywordInsight } from "./types";

// ResearchService — runs one full intelligence pass and (optionally) writes the narrative
// through the EXISTING LLM orchestration (lib/services/llm). No second orchestration layer
// is introduced, and the narrative is strictly optional: if the model is unavailable the
// brief still ships with all its structured intelligence intact (graceful degradation).

export type ResearchDeps = {
  aggregator: SignalAggregator;
  trends?: TrendService;
  competitors?: CompetitorService;
  keywords?: KeywordService;
  audiences?: AudienceInsightService;
  opportunities?: OpportunityEngine;
  now?: () => number;
};

export type ResearchOptions = {
  /** Write the narrative with the LLM. Off by default so tests stay deterministic. */
  withNarrative?: boolean;
};

export class ResearchService {
  private trends: TrendService;
  private competitors: CompetitorService;
  private keywords: KeywordService;
  private audiences: AudienceInsightService;
  private opportunities: OpportunityEngine;
  private now: () => number;

  constructor(private deps: ResearchDeps) {
    this.now = deps.now ?? Date.now;
    this.trends = deps.trends ?? new TrendService({ now: this.now });
    this.competitors = deps.competitors ?? new CompetitorService({ now: this.now });
    this.keywords = deps.keywords ?? new KeywordService({ now: this.now });
    this.audiences = deps.audiences ?? new AudienceInsightService();
    this.opportunities = deps.opportunities ?? new OpportunityEngine();
  }

  /** One full pass: collect → analyse → score opportunities → (optionally) narrate. */
  async run(query: MarketQuery, opts: ResearchOptions = {}): Promise<ResearchBrief> {
    const at = this.now();
    const collection = await this.deps.aggregator.collect(query);
    const signals = collection.signals;

    const trends = this.trends.detect(signals);
    const competitors = this.competitors.profileAll(query.competitors ?? [], signals);
    const keywords = this.keywords.discover(signals);
    const audiences = this.audiences.analyze(signals);
    const opportunities = this.opportunities.generate({
      trends, competitors, keywords, audiences, ownTopics: query.terms, now: at,
    });

    const risks = opportunities.filter((o) => o.kind === "emerging_risk").map((o) => o.title);
    const headline = this.headline(trends, opportunities, collection.failed.length);

    const brief: ResearchBrief = {
      tenant: query.tenant,
      generatedAt: at,
      headline,
      trends: trends.slice(0, 10),
      opportunities: opportunities.slice(0, 10),
      competitors,
      keywords: keywords.slice(0, 10),
      risks,
      narrative: null,
    };

    if (opts.withNarrative) brief.narrative = await this.narrate(brief);
    console.info(JSON.stringify({
      event: "market_research", tenant: query.tenant, signals: signals.length,
      trends: trends.length, opportunities: opportunities.length, degraded: collection.failed.length,
    }));
    return brief;
  }

  /** Deterministic headline — always available, even with no model. */
  private headline(trends: Trend[], opps: Opportunity[], degraded: number): string {
    const top = opps[0];
    const suffix = degraded > 0 ? ` (${degraded} source${degraded === 1 ? "" : "s"} unavailable)` : "";
    if (top) return `${top.title}${suffix}`;
    if (trends[0]) return `${trends[0].topic} is the strongest signal this week${suffix}`;
    return `No strong market signals detected this week${suffix}`;
  }

  /**
   * Narrative via the existing LLM service. Returns null on any failure — the brief is
   * already complete without it.
   */
  private async narrate(brief: ResearchBrief): Promise<string | null> {
    const facts = [
      `Trends: ${brief.trends.slice(0, 5).map((t) => `${t.topic} (confidence ${t.confidence}, velocity ${t.velocity})`).join("; ") || "none"}`,
      `Opportunities: ${brief.opportunities.slice(0, 5).map((o) => o.title).join("; ") || "none"}`,
      `Competitors: ${brief.competitors.map((c) => c.summary).join(" ") || "none observed"}`,
      `Keywords: ${brief.keywords.slice(0, 5).map((k) => `${k.keyword} (opportunity ${k.opportunity})`).join("; ") || "none"}`,
    ].join("\n");

    try {
      const res = await generateText({
        prompt:
`You are a marketing analyst writing this week's research brief for a founder.
Use ONLY these observed facts — never invent numbers, competitors or trends:

${facts}

Write 4-6 sentences of plain, direct prose. Lead with what changed and what to do about it.
No headings, no bullet points, no preamble.`,
        url: null,
      });
      return res.ok ? res.text.trim() : null;
    } catch {
      return null;   // graceful degradation — structured intelligence still ships
    }
  }

  /**
   * Campaign ideas grounded in the brief. Returns [] when the model is unavailable so
   * callers never have to special-case a failure.
   */
  async campaignIdeas(brief: ResearchBrief, limit = 5): Promise<{ title: string; angle: string }[]> {
    if (brief.opportunities.length === 0) return [];
    try {
      const res = await generateText({
        prompt:
`Based ONLY on these opportunities, propose ${limit} campaign ideas.
${brief.opportunities.slice(0, limit).map((o, i) => `${i + 1}. ${o.title} — ${o.reasoning}`).join("\n")}

Respond ONLY with JSON: {"ideas":[{"title":"short campaign name","angle":"one sentence"}]}`,
        url: null,
      });
      if (!res.ok) return [];
      const parsed = extractJson<{ ideas?: { title?: string; angle?: string }[] }>(res.text);
      return (parsed.ideas ?? [])
        .filter((i) => i.title && i.angle)
        .slice(0, limit)
        .map((i) => ({ title: String(i.title), angle: String(i.angle) }));
    } catch {
      return [];
    }
  }
}

export type { CompetitorProfile, KeywordInsight };
