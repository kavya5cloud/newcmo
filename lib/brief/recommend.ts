import type {
  ApprovalsSection, CampaignsSection, MarketSection, PerformanceSection,
  PublishingSection, Recommendation,
} from "./types";

// Choosing the one thing worth doing.
//
// Deterministic and ranked. A recommendation drives a real action, so it must be
// predictable and explainable — and the ranking encodes an opinion: things that are
// *broken* outrank things that are *waiting*, which outrank things that are merely
// *possible*. A brief that suggests writing more content while three publishes are
// failing is a brief nobody trusts twice.
//
// Exactly one is shown. A list of five recommendations is a to-do list, and the point of
// the brief is to remove the deciding.

export type RecommendInput = {
  publishing: PublishingSection;
  campaigns: CampaignsSection;
  market: MarketSection;
  performance: PerformanceSection;
  approvals: ApprovalsSection;
  connectedPlatforms: string[];
  hasContent: boolean;
};

/** Every candidate, ranked. Exported so the ordering itself can be tested. */
export function candidates(input: RecommendInput): Recommendation[] {
  const out: Recommendation[] = [];

  // Broken beats everything: work already committed that isn't going out.
  if (input.publishing.retryable > 0) {
    out.push({
      kind: "retry_publishing",
      title: `Retry ${input.publishing.retryable} failed publish${input.publishing.retryable === 1 ? "" : "es"}`,
      why: `${input.publishing.retryable} post${input.publishing.retryable === 1 ? "" : "s"} failed for a reason that clears on its own. They will not go out until they are retried.`,
      href: "/studio/social", command: null, priority: 100,
    });
  }

  if (input.publishing.failed > input.publishing.retryable) {
    const stuck = input.publishing.failed - input.publishing.retryable;
    out.push({
      kind: "connect_platform",
      title: `Fix ${stuck} publish${stuck === 1 ? "" : "es"} that cannot retry`,
      why: `${stuck} failure${stuck === 1 ? "" : "s"} need a person — usually an expired connection. Retrying will not help until that is fixed.`,
      href: "/studio/integrations", command: null, priority: 95,
    });
  }

  // Nothing can publish at all.
  if (input.connectedPlatforms.length === 0) {
    out.push({
      kind: "connect_platform",
      title: "Connect a platform",
      why: "Nothing can publish yet. Connecting one account turns every draft and schedule you already have into posts that actually go out.",
      href: "/studio/social", command: null, priority: 92,
    });
  }

  // Waiting on a human, blocking real work.
  if (input.approvals.count > 0) {
    const first = input.approvals.items[0];
    out.push({
      kind: "approve",
      title: input.approvals.count === 1 && first ? `Approve ${first.label}` : `Approve ${input.approvals.count} items`,
      why: `Nothing behind ${input.approvals.count === 1 ? "it" : "them"} moves until you decide. Everything else is ready.`,
      href: first?.href ?? "/studio/launch#execution", command: null, priority: 88,
    });
  }

  if (input.campaigns.blocked > 0) {
    const line = input.campaigns.lines.find((l) => l.blocked);
    out.push({
      kind: "review_performance",
      title: `Unblock ${line?.title ?? "a campaign"}`,
      why: line?.reason ?? "A campaign is blocked and will not progress on its own.",
      href: "/studio/launch#execution", command: null, priority: 85,
    });
  }

  // Time-sensitive opportunity: acting late is the same as not acting.
  if (input.market.opportunities.length > 0) {
    out.push({
      kind: "respond_to_trend",
      title: "Respond to what the market is doing",
      why: `${input.market.opportunities[0]}. Opportunities like this decay — publishing into a rising topic beats publishing after it peaks.`,
      href: "/studio/market", command: null, priority: 70,
    });
  }

  // Nothing scheduled: the schedule going quiet is a slow failure.
  if (input.publishing.today === 0 && input.publishing.nextAt === null) {
    out.push({
      kind: "generate_content",
      title: "Get something into the schedule",
      why: "Nothing is scheduled to publish. A quiet week costs more than a mediocre post.",
      href: "/studio/documents", command: null, priority: 65,
    });
  }

  if (!input.hasContent) {
    out.push({
      kind: "create_campaign",
      title: "Plan your first campaign",
      why: "One mission becomes a sequenced campaign with assets, approvals and a publishing schedule — rather than posts decided one at a time.",
      href: "/studio/launch", command: null, priority: 60,
    });
  }

  if (input.performance.bestPlatform) {
    out.push({
      kind: "generate_content",
      title: `Write more for ${input.performance.bestPlatform}`,
      why: `${input.performance.bestPlatform} is your strongest platform so far. More of what already works beats spreading thinner.`,
      href: "/studio/documents", command: null, priority: 40,
    });
  }

  return out.sort((a, b) => b.priority - a.priority);
}

/** The single recommendation. Always returns one — silence is not helpful at 9am. */
export function recommend(input: RecommendInput): Recommendation {
  const [top] = candidates(input);
  if (top) return top;
  return {
    kind: "generate_content",
    title: "Write this week's posts",
    why: "Nothing needs your attention, which is the right time to get ahead of the schedule.",
    href: "/studio/documents", command: null, priority: 10,
  };
}
