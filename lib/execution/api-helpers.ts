import { workspaceKey } from "@/lib/intel";
import { resolvePlan, workspaceStateRepo } from "@/lib/launch/shared";
import { campaignProgress, emptyState, type WorkspaceState } from "@/lib/launch/workspace";
import { marketPlatform } from "@/lib/market/shared";
import { socialEngine } from "@/lib/social/shared";
import { executionPlatform } from "./shared";
import type { CampaignHealth, ExecutionState, Notification } from "./types";
import type { LaunchPlan } from "@/lib/launch/types";

// Shared assembly for the execution APIs: load everything the dashboard needs from the
// engines that own it, in one place, so each route stays thin and the panels can never
// disagree about what is true.

export async function tenantOf(v: string | null): Promise<string> {
  return (await workspaceKey(v)) ?? "default";
}

export type LiveContext = {
  tenant: string;
  plan: LaunchPlan;
  execution: ExecutionState;
  workspace: WorkspaceState;
};

export async function loadContext(tenant: string, launchId: string | null): Promise<LiveContext> {
  const plan = await resolvePlan(tenant, launchId);
  const p = executionPlatform();
  const [execution, workspace] = await Promise.all([
    p.state.get(tenant, plan.launchId).catch(() => p.state.get(tenant, plan.launchId)),
    workspaceStateRepo().get(tenant, plan.launchId).catch(() => emptyState(tenant, plan.launchId)),
  ]);
  return { tenant, plan, execution, workspace };
}

/** Day the launch is on, from the plan's own timeline — never wall-clock guesswork. */
export function currentDay(plan: LaunchPlan, execution: ExecutionState, now: number): number {
  const started = Object.values(execution.campaigns)
    .map((c) => c.createdAt)
    .filter((t) => t > 0)
    .sort((a, b) => a - b)[0];
  if (!started) return 0;
  return Math.min(plan.timelineDays, Math.floor((now - started) / 86_400_000));
}

export type LiveSnapshot = {
  healths: CampaignHealth[];
  notifications: Notification[];
  publishing: {
    accounts: { id: string; platform: string; handle: string; status: string }[];
    failed: number;
    queued: number;
    scheduled: number;
  };
};

/** Health + notifications + platform status, assembled from the live engines. */
export async function assembleSnapshot(ctx: LiveContext, now: number): Promise<LiveSnapshot> {
  const p = executionPlatform();
  const engine = socialEngine();

  const [accounts, jobs] = await Promise.all([
    engine.listAccounts(ctx.tenant).catch(() => []),
    engine.listJobs(ctx.tenant).catch(() => []),
  ]);
  const connected = accounts.filter((a) => a.status === "connected");
  const failed = jobs.filter((j) => j.state === "failed" || j.state === "dead_letter").length;

  // Competitor moves come from Market Intelligence; a dead source degrades to "none
  // observed" rather than blocking the dashboard.
  let competitorMoves: string[] = [];
  try {
    const brief = await marketPlatform().research.run({
      tenant: ctx.tenant, terms: [ctx.plan.mission], competitors: [], industry: "saas",
      audience: ctx.plan.campaigns[0]?.brief?.audience ?? "founders",
    });
    competitorMoves = brief.competitors.filter((c) => c.postCount > 0).map((c) => `${c.name}: ${c.summary}`);
  } catch { competitorMoves = []; }

  const progress = campaignProgress(ctx.plan, ctx.workspace);
  const day = currentDay(ctx.plan, ctx.execution, now);

  const healths = ctx.plan.campaigns.map((c) => {
    const prog = progress.find((x) => x.campaignId === c.id);
    return p.health.assess({
      campaignId: c.id,
      execution: ctx.execution.campaigns[c.id] ?? null,
      itemsTotal: prog?.total ?? 0,
      itemsDone: prog?.done ?? 0,
      failedJobs: failed,
      connectedAccounts: connected.length,
      plannedChannels: c.channels.length,
      nextPublishDay: prog?.nextPublish?.dayOffset ?? null,
      currentDay: day,
      engagement: null,
      competitorMoves,
    });
  });

  const itemsTotal = progress.reduce((n, x) => n + x.total, 0);
  const itemsDone = progress.reduce((n, x) => n + x.done, 0);
  const dismissed = await p.dismissals.dismissed(ctx.tenant, ctx.plan.launchId).catch(() => ({}));

  const notifications = p.notifications.merge(
    p.notifications.derive({
      tenant: ctx.tenant, launchId: ctx.plan.launchId, now, healths,
      connectedPlatforms: connected.map((a) => a.platform),
      failedPublishes: failed,
      awaitingApprovals: p.engine.approvals.awaitingCount(Object.values(ctx.execution.campaigns)),
      competitorMoves,
      itemsDone, itemsTotal,
      expectedDonePercent: ctx.plan.timelineDays ? Math.min(1, day / ctx.plan.timelineDays) : 0,
    }),
    dismissed,
  );

  return {
    healths,
    notifications,
    publishing: {
      accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, handle: a.handle, status: a.status })),
      failed,
      queued: jobs.filter((j) => j.state === "queued").length,
      scheduled: jobs.filter((j) => j.state === "scheduled").length,
    },
  };
}
