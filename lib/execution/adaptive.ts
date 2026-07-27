import { createHash } from "node:crypto";
import type { LaunchPlan } from "@/lib/launch/types";
import type { AdaptationProposal, AdaptationType } from "./types";

// AdaptiveTimeline — Market Intelligence proposing changes to a running launch.
//
// The hard rule: nothing here ever modifies a campaign. It produces *proposals* with the
// evidence behind them; a human approves or rejects. An engine that silently re-times
// someone's launch because a competitor posted is not an assistant, it's a hazard.

export type MarketSnapshot = {
  /** Trends with confidence, from the M13 TrendService. */
  trends: { topic: string; confidence: number; velocity: number }[];
  /** Competitor summaries observed this window. */
  competitors: { name: string; summary: string; engagementTrend?: string }[];
  /** Opportunity cards already scored by the M13 OpportunityEngine. */
  opportunities: { id: string; title: string; recommendedAction: string; confidence: number; urgency: string }[];
};

function pid(type: AdaptationType, key: string): string {
  return "adp_" + createHash("sha256").update(`${type}|${key}`).digest("hex").slice(0, 16);
}

export class AdaptiveTimeline {
  /**
   * Derive proposals from the current market picture. Stable ids so a decision persists
   * across polls; every proposal carries the observed facts that produced it.
   */
  propose(plan: LaunchPlan, market: MarketSnapshot, opts: { currentDay: number } = { currentDay: 0 }): AdaptationProposal[] {
    const out: AdaptationProposal[] = [];
    const base = { status: "proposed" as const, decidedAt: null };

    const surging = market.trends.filter((t) => t.confidence >= 0.6 && t.velocity >= 0.5).slice(0, 2);
    for (const t of surging) {
      out.push({
        ...base, id: pid("accelerate_launch", t.topic), type: "accelerate_launch", campaignId: null,
        title: `Bring the launch forward while "${t.topic}" is rising`,
        rationale: `"${t.topic}" is trending with ${Math.round(t.confidence * 100)}% confidence and rising velocity. Publishing into a rising trend beats publishing after it peaks.`,
        evidence: [`trend "${t.topic}" confidence ${Math.round(t.confidence * 100)}%`, `velocity ${Math.round(t.velocity * 100)}%`],
        confidence: Number(((t.confidence + t.velocity) / 2).toFixed(3)),
      });
    }

    const risingRivals = market.competitors.filter((c) => c.engagementTrend === "rising").slice(0, 2);
    for (const c of risingRivals) {
      out.push({
        ...base, id: pid("response_campaign", c.name), type: "response_campaign", campaignId: null,
        title: `Draft a response campaign to ${c.name}`,
        rationale: `${c.name}'s engagement is rising. A response campaign lands while the audience is already paying attention to the category.`,
        evidence: [`${c.name}: ${c.summary}`, "engagement trend rising"],
        confidence: 0.6,
      });
    }

    for (const o of market.opportunities.filter((x) => x.confidence >= 0.55).slice(0, 3)) {
      out.push({
        ...base, id: pid("generate_asset", o.id), type: "generate_asset", campaignId: null,
        title: o.title,
        rationale: o.recommendedAction,
        evidence: [`opportunity confidence ${Math.round(o.confidence * 100)}%`, `urgency ${o.urgency}`],
        confidence: o.confidence,
      });
    }

    // Slipped slots are a scheduling fact, not a market one — proposed as a move, never applied.
    const overdue = plan.publishingSchedule.filter((s) => s.dayOffset < opts.currentDay);
    if (overdue.length > 0) {
      const c = overdue[0];
      out.push({
        ...base, id: pid("delay_post", `${c.assetKey}:${opts.currentDay}`), type: "delay_post", campaignId: null,
        title: `Re-time ${overdue.length} overdue publish slot${overdue.length === 1 ? "" : "s"}`,
        rationale: `The launch is on day ${opts.currentDay} and ${overdue.length} slot${overdue.length === 1 ? " is" : "s are"} already past due. Moving them forward keeps the sequence intact instead of dropping posts.`,
        evidence: overdue.slice(0, 3).map((s) => `${s.kind.replace(/_/g, " ")} · ${s.channel} · was day ${s.dayOffset}`),
        confidence: 0.8,
      });
      void c;
    }

    return out.sort((a, b) => b.confidence - a.confidence);
  }

  /** Record a decision. Approval does not itself change the plan — it authorises the change. */
  decide(proposal: AdaptationProposal, decision: "approved" | "rejected", now: number): AdaptationProposal {
    return { ...proposal, status: decision, decidedAt: now };
  }
}
