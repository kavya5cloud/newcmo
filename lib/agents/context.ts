import { marketPlatform } from "@/lib/market/shared";
import { socialEngine } from "@/lib/social/shared";
import { learningEngine } from "@/lib/learning/shared";
import { db } from "@/lib/db";
import { loadCanonicalProfile } from "@/lib/services/cmo-context";
import type { LaunchCampaign, LaunchPlan } from "@/lib/launch/types";
import type { SharedContext } from "./types";

// SharedContextAssembler — one read of the world, handed to every agent.
//
// Assembled once per step from the live services rather than each agent fetching its own,
// for two reasons: it halves the work, and it makes it impossible for the Content agent and
// the Publishing agent to be looking at different versions of the same campaign.
//
// Every source degrades independently. A dead market source costs the market section, not
// the run — and the agent that relied on it says so in its reasoning and drops its
// confidence, rather than inventing the missing half.

export type AssembleInput = {
  tenant: string;
  launchId: string;
  plan: LaunchPlan;
  campaign: LaunchCampaign;
  now: number;
};

export async function assembleContext(input: AssembleInput): Promise<SharedContext> {
  const { tenant, plan, campaign, now } = input;

  const sql = db();
  const [accounts, jobs, history, memory, market, drafts, profile] = await Promise.all([
    socialEngine().listAccounts(tenant).catch(() => []),
    socialEngine().listJobs(tenant).catch(() => []),
    socialEngine().listHistory(tenant).catch(() => []),
    marketPlatform().memory.list(tenant, undefined, 20).catch(() => []),
    marketPlatform().research.run({
      tenant, terms: [plan.mission, campaign.title], competitors: [],
      industry: "saas", audience: campaign.brief.audience,
    }).catch(() => null),
    // The Editor grades what has actually been written, not a sample it invents.
    socialEngine().listDrafts(tenant).catch(() => []),
    // business_profiles is where the analysed site lives. Absent for a workspace that has
    // never been analysed, which the SEO agent reports rather than papering over.
    sql ? loadCanonicalProfile(sql, tenant).catch(() => null) : Promise.resolve(null),
  ]);

  // Brand voice comes from the Learning Engine's evolved Brand DNA when it exists — the
  // brief's tone is the fallback, not the source of truth.
  let voice: string[] = [campaign.brief.emotionalAngle, campaign.brief.keyMessage].filter(Boolean);
  try {
    const brand = await learningEngine(db()).brand.latest(tenant);
    if (brand) {
      const learned = Object.entries(brand.traits)
        .filter(([, v]) => v.evidence > 0)
        .sort((a, b) => b[1].confidence - a[1].confidence)
        .slice(0, 4)
        .map(([trait, v]) => `${trait}: ${v.value}`);
      if (learned.length) voice = learned;
    }
  } catch { /* Brand DNA is optional; the brief still describes the voice. */ }

  return {
    tenant,
    launchId: plan.launchId,
    campaignId: campaign.id,
    brand: {
      name: plan.mission,
      oneLiner: campaign.brief.keyMessage || plan.mission,
      voice,
    },
    audience: campaign.brief.audience,
    campaign: {
      id: campaign.id, title: campaign.title, goal: campaign.goal, phase: campaign.phase,
      channels: campaign.channels, assetCount: campaign.assetPlan.summary.total,
    },
    goals: {
      objectives: plan.objectives.map((o) => o.statement),
      kpis: plan.kpis,
    },
    connectedPlatforms: accounts.map((a) => ({ platform: a.platform, handle: a.handle, status: a.status })),
    site: (profile as { url?: string } | null)?.url?.trim() || null,
    drafts: drafts.slice(0, 12).map((d) => ({ id: d.id, title: d.title, text: d.content.text })),
    analytics: {
      published: history.filter((h) => h.state === "published").length,
      failed: jobs.filter((j) => j.state === "failed" || j.state === "dead_letter").length,
      scheduled: jobs.filter((j) => j.state === "scheduled").length,
    },
    market: {
      headline: market?.headline ?? "Market data unavailable for this run.",
      trends: (market?.trends ?? []).slice(0, 5).map((t) => `${t.topic} (${Math.round(t.confidence * 100)}%)`),
      competitors: (market?.competitors ?? []).slice(0, 4).map((c) => `${c.name}: ${c.summary}`),
      opportunities: (market?.opportunities ?? []).slice(0, 5).map((o) => `${o.title} → ${o.recommendedAction}`),
    },
    previousCampaigns: plan.campaigns.filter((c) => c.id !== campaign.id).map((c) => `${c.title} (${c.goal})`),
    memory: memory.map((m) => ({ key: m.key, value: m.value, performance: m.performance })),
    now,
  };
}

/** Did the market half of the context actually load? Agents lower confidence when not. */
export function hasMarketData(ctx: SharedContext): boolean {
  return ctx.market.trends.length > 0 || ctx.market.competitors.length > 0 || ctx.market.opportunities.length > 0;
}
