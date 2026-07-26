import type {
  AudienceInsight, CompetitorProfile, KeywordInsight, Opportunity, OpportunityKind,
  Tier, Trend,
} from "./types";
import { clamp01, idFrom, round } from "./util";

// OpportunityEngine — converts intelligence into decisions. Every card carries the
// EVIDENCE it came from, so a founder can audit the claim rather than trust a number.
// Deterministic: the same intelligence always produces the same ranked cards.

const IMPACT_AT = { high: 0.66, medium: 0.4 };
const URGENCY_AT = { high: 0.7, medium: 0.45 };

function tier(x: number, at: { high: number; medium: number }): Tier {
  return x >= at.high ? "high" : x >= at.medium ? "medium" : "low";
}

export type OpportunityInput = {
  trends: Trend[];
  competitors: CompetitorProfile[];
  keywords: KeywordInsight[];
  audiences?: AudienceInsight[];
  /** Topics we already cover — used to spot genuine gaps. */
  ownTopics?: string[];
  now?: number;
};

export class OpportunityEngine {
  /** Generate ranked opportunity cards from the current intelligence. */
  generate(input: OpportunityInput): Opportunity[] {
    const now = input.now ?? Date.now();
    const out: Opportunity[] = [
      ...this.fromTrends(input.trends, now),
      ...this.fromCompetitors(input.competitors, now),
      ...this.fromKeywords(input.keywords, now),
      ...this.fromAudiences(input.audiences ?? [], now),
    ];
    return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }

  private card(
    kind: OpportunityKind, title: string, confidence: number, impactScore: number,
    urgencyScore: number, reasoning: string, action: string, campaign: string,
    evidence: string[], now: number,
  ): Opportunity {
    const score = clamp01(0.45 * confidence + 0.35 * impactScore + 0.20 * urgencyScore);
    return {
      id: idFrom("opp", kind, title),
      kind,
      title,
      confidence: round(confidence),
      expectedImpact: tier(impactScore, IMPACT_AT),
      reasoning,
      recommendedAction: action,
      suggestedCampaign: campaign,
      urgency: tier(urgencyScore, URGENCY_AT),
      evidence,
      score: round(score),
      createdAt: now,
    };
  }

  // Rising / viral / seasonal trends → act-now content opportunities.
  private fromTrends(trends: Trend[], now: number): Opportunity[] {
    return trends
      .filter((t) => t.velocity >= 0.55 && t.confidence >= 0.35)
      .slice(0, 8)
      .map((t) => {
        const viral = t.kind === "viral";
        const kind: OpportunityKind = t.kind === "seasonal" ? "seasonal_window" : viral ? "viral_moment" : "rising_trend";
        const title = viral
          ? `"${t.topic}" is going viral`
          : t.kind === "seasonal"
            ? `Seasonal window opening: ${t.topic}`
            : `${t.topic} discussions are increasing`;
        return this.card(
          kind, title,
          t.confidence,
          t.strength,
          t.velocity,
          `${t.signalCount} signal${t.signalCount === 1 ? "" : "s"} across ${t.sources.length} source${t.sources.length === 1 ? "" : "s"} (${t.sources.join(", ")}), growing at ${Math.round(t.velocity * 100)}%.`,
          viral ? `Publish within 48 hours while attention peaks` : `Create a post targeting "${t.topic}" this week`,
          `${t.topic} — ${viral ? "rapid-response" : "thought leadership"} campaign`,
          [`${t.signalCount} signals`, `sources: ${t.sources.join(", ")}`, ...t.sampleTitles.slice(0, 2)],
          now,
        );
      });
  }

  // Competitor slowdowns and content gaps → share-of-voice openings.
  private fromCompetitors(profiles: CompetitorProfile[], now: number): Opportunity[] {
    const out: Opportunity[] = [];
    for (const c of profiles) {
      if (c.postCount === 0) continue;

      if (c.engagementTrend === "falling" || c.postingFrequencyPerWeek < 1) {
        const conf = clamp01(0.4 + 0.6 * Math.min(1, c.postCount / 6));
        out.push(this.card(
          "competitor_gap",
          `${c.name}'s posting frequency has dropped`,
          conf,
          0.6,
          0.5,
          `${c.name} posted ~${c.postingFrequencyPerWeek}/week and engagement is ${c.engagementTrend}. Share of voice is available.`,
          `Increase publishing cadence on their core topics while they are quiet`,
          `Share-of-voice push against ${c.name}`,
          [`${c.postCount} observed posts`, `~${c.postingFrequencyPerWeek}/week`, `engagement ${c.engagementTrend}`],
          now,
        ));
      }

      if (c.engagementTrend === "rising" && c.growthRate > 0.2) {
        out.push(this.card(
          "emerging_risk",
          `${c.name} is gaining engagement`,
          clamp01(0.35 + c.growthRate),
          0.55,
          0.6,
          `${c.name}'s engagement is rising (${Math.round(c.growthRate * 100)}%). ${c.campaignPatterns[0] ?? "They are publishing consistently."}`,
          `Review what is working for them and close the gap`,
          `Competitive response — ${c.name}`,
          [`growth ${Math.round(c.growthRate * 100)}%`, ...c.campaignPatterns.slice(0, 2), ...c.topPosts.slice(0, 1).map((p) => p.title)],
          now,
        ));
      }
    }
    return out;
  }

  // High-opportunity keywords → winnable demand.
  private fromKeywords(keywords: KeywordInsight[], now: number): Opportunity[] {
    return keywords
      .filter((k) => k.opportunity >= 0.5)
      .slice(0, 6)
      .map((k) => this.card(
        "keyword_opportunity",
        `High-growth keyword detected: "${k.keyword}"`,
        clamp01(k.opportunity),
        k.volume,
        clamp01(k.opportunity * 0.8),
        `"${k.keyword}" scores ${k.opportunity} on opportunity — volume ${k.volume}, difficulty ${k.difficulty}. It sits in the "${k.cluster}" cluster.`,
        k.contentSuggestions[0] ?? `Target "${k.keyword}" with a dedicated page`,
        `${k.cluster} content cluster`,
        [`opportunity ${k.opportunity}`, `difficulty ${k.difficulty}`, `cluster: ${k.cluster}`],
        now,
      ));
  }

  // Audience interest concentration → targeting opportunities.
  private fromAudiences(audiences: AudienceInsight[], now: number): Opportunity[] {
    return audiences
      .filter((a) => a.confidence >= 0.5 && a.interests.length > 0)
      .slice(0, 4)
      .map((a) => {
        const top = a.interests[0];
        return this.card(
          "audience_shift",
          `${a.segment} are focused on "${top.topic}"`,
          a.confidence,
          top.affinity,
          0.45,
          `Across ${a.sampleSize} signals, "${top.topic}" has the highest affinity (${top.affinity}) for ${a.segment}. Active on ${a.activeChannels.join(", ")}.`,
          `Reframe messaging for ${a.segment} around "${top.topic}"`,
          `${a.segment} — ${top.topic} campaign`,
          [`${a.sampleSize} signals`, `affinity ${top.affinity}`, `channels: ${a.activeChannels.join(", ")}`],
          now,
        );
      });
  }
}
