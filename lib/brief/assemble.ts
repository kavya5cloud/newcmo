import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { socialEngine } from "@/lib/social/shared";
import { marketPlatform } from "@/lib/market/shared";
import { learningEngine } from "@/lib/learning/shared";
import { executionPlatform } from "@/lib/execution/shared";
import { teamPlatform } from "@/lib/agents/shared";
import { automationRepo } from "@/lib/automation/shared";
import { resolvePlan, workspaceStateRepo } from "@/lib/launch/shared";
import { campaignProgress, emptyState } from "@/lib/launch/workspace";
import { recommend } from "./recommend";
import type {
  ActivityLine, ApprovalsSection, CampaignsSection, DailyBrief, MarketSection,
  PerformanceSection, PublishingSection, UpcomingItem, UpcomingSection,
} from "./types";

// Assembling the brief.
//
// Every section is read from the engine that already owns it. Nothing is recomputed here,
// so the brief cannot disagree with the screen it links to. Each source is caught
// independently: a dead market feed costs the market section, not the morning.

const DAY = 86_400_000;

function startOfDay(t: number): number {
  const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime();
}

function greetingFor(t: number): string {
  const h = new Date(t).getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export type AssembleOptions = { tenant: string; now: number; company?: string };

export async function assembleBrief(opts: AssembleOptions): Promise<DailyBrief> {
  const { tenant, now } = opts;
  const dayStart = startOfDay(now);
  const dayEnd = dayStart + DAY;
  const engine = socialEngine();
  const exec = executionPlatform();

  const [accounts, jobs, history, plan] = await Promise.all([
    engine.listAccounts(tenant).catch(() => []),
    engine.listJobs(tenant).catch(() => []),
    engine.listHistory(tenant).catch(() => []),
    resolvePlan(tenant, null).catch(() => null),
  ]);

  const connected = [...new Set(accounts.filter((a) => a.status === "connected").map((a) => a.platform))];

  // ---- Publishing ----
  const scheduledToday = jobs.filter((j) => j.scheduledAt != null && j.scheduledAt >= dayStart && j.scheduledAt < dayEnd);
  const failedJobs = jobs.filter((j) => j.state === "failed" || j.state === "dead_letter");
  // A dead-letter job has exhausted its retries; suggesting a retry would be a lie.
  const retryable = failedJobs.filter((j) => j.state === "failed").length;
  const upcomingJobs = jobs
    .filter((j) => j.state === "scheduled" && j.scheduledAt != null && j.scheduledAt >= now)
    .sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));

  const publishing: PublishingSection = {
    today: scheduledToday.length,
    awaitingApproval: 0,           // filled from execution state below
    failed: failedJobs.length,
    retryable,
    nextAt: upcomingJobs[0]?.scheduledAt ?? null,
    nextPlatform: upcomingJobs[0]?.platform ?? null,
    links: [{ label: "Open Cross-Post", href: "/studio/social" }],
  };

  // ---- Campaigns + approvals, from the Execution Engine ----
  let campaigns: CampaignsSection = { running: 0, completed: 0, blocked: 0, lines: [], links: [{ label: "Open Launch Workspace", href: "/studio/launch" }] };
  const approvalItems: ApprovalsSection["items"] = [];

  if (plan) {
    const [execState, wsState] = await Promise.all([
      exec.state.get(tenant, plan.launchId).catch(() => null),
      workspaceStateRepo().get(tenant, plan.launchId).catch(() => emptyState(tenant, plan.launchId)),
    ]);
    const progress = campaignProgress(plan, wsState);

    campaigns = {
      running: Object.values(execState?.campaigns ?? {}).filter((c) => c.status === "running").length,
      completed: progress.filter((p) => p.status === "complete").length,
      blocked: 0,
      lines: [],
      links: campaigns.links,
    };

    for (const c of plan.campaigns) {
      const p = progress.find((x) => x.campaignId === c.id);
      const e = execState?.campaigns[c.id];
      const health = exec.health.assess({
        campaignId: c.id,
        execution: e ?? null,
        itemsTotal: p?.total ?? 0,
        itemsDone: p?.done ?? 0,
        failedJobs: failedJobs.length,
        connectedAccounts: connected.length,
        plannedChannels: c.channels.length,
        nextPublishDay: p?.nextPublish?.dayOffset ?? null,
        currentDay: 0,
        engagement: null,
        competitorMoves: [],
      });
      const blocked = health.status === "blocked";
      if (blocked) campaigns.blocked++;
      campaigns.lines.push({
        id: c.id, title: c.title, health: health.status,
        percent: Math.round((p?.percent ?? 0) * 100),
        blocked, reason: blocked ? health.reasons[0]?.message ?? null : null,
      });

      for (const step of e?.steps.filter((s) => s.status === "waiting_approval") ?? []) {
        approvalItems.push({
          id: `${c.id}:${step.step}`,
          label: `${c.title} — ${step.step.replace(/_/g, " ")}`,
          href: "/studio/launch#execution",
        });
      }
    }
  }
  publishing.awaitingApproval = approvalItems.length;

  // ---- Market: only meaningful changes ----
  let market: MarketSection = { trends: [], competitors: [], opportunities: [], keywords: [], links: [{ label: "Open Market Intel", href: "/studio/market" }] };
  try {
    const brief = await marketPlatform().research.run({
      tenant, terms: [plan?.mission ?? opts.company ?? "our product"], competitors: [],
      industry: "saas", audience: plan?.campaigns[0]?.brief?.audience ?? "founders",
    });
    market = {
      // A low-confidence trend is noise; the brief exists to remove noise.
      trends: brief.trends.filter((t) => t.confidence >= 0.6).slice(0, 3).map((t) => t.topic),
      competitors: brief.competitors.filter((c) => c.postCount > 0).slice(0, 2).map((c) => `${c.name}: ${c.summary}`),
      opportunities: brief.opportunities.filter((o) => o.confidence >= 0.55).slice(0, 2).map((o) => `${o.title} — ${o.recommendedAction}`),
      keywords: brief.keywords.filter((k) => k.opportunity >= 0.5).slice(0, 3).map((k) => k.keyword),
      links: market.links,
    };
  } catch { /* market unavailable: the section is empty rather than wrong */ }

  // ---- Performance, from the Learning Engine ----
  const performance: PerformanceSection = { bestPlatform: null, winningFormat: null, bestTime: null, improvements: [], detail: [] };
  try {
    const sql = db();
    const patterns = await learningEngine(sql).patterns.all();
    const published = history.filter((h) => h.state === "published");

    const byPlatform = new Map<string, number>();
    for (const h of published) byPlatform.set(h.platform, (byPlatform.get(h.platform) ?? 0) + 1);
    const top = [...byPlatform.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) performance.bestPlatform = top[0];

    const best = [...patterns].sort((a, b) => b.performance - a.performance)[0];
    if (best) {
      performance.winningFormat = best.value;
      performance.improvements.push(`${best.label} is performing best so far.`);
      performance.detail.push({ label: best.label, value: `${Math.round(best.performance * 100)}%` });
    }
    if (published.length) performance.detail.push({ label: "Published", value: String(published.length) });
    if (byPlatform.size) {
      for (const [p, n] of byPlatform) performance.detail.push({ label: p, value: `${n} post${n === 1 ? "" : "s"}` });
    }
  } catch { /* learning unavailable */ }

  // ---- Recent AI activity, newest first ----
  const activity: ActivityLine[] = [];
  try {
    if (plan) {
      const events = await exec.historyStore.list(tenant, plan.launchId, 12);
      for (const e of events) activity.push({ at: e.at, kind: e.kind, message: e.message });
    }
    const teamState = plan ? await teamPlatform().state.get(tenant, plan.launchId) : null;
    for (const t of (teamState?.tasks ?? []).slice(-6)) {
      activity.push({ at: t.completedAt ?? t.startedAt, kind: `agent:${t.agent}`, message: t.task });
    }
  } catch { /* activity unavailable */ }
  activity.sort((a, b) => b.at - a.at);

  // ---- Upcoming ----
  const items: UpcomingItem[] = [
    ...upcomingJobs.slice(0, 20).map((j) => ({
      at: j.scheduledAt!, label: `Publish to ${j.platform}`, kind: "publish" as const,
    })),
    ...approvalItems.map((a) => ({ at: now, label: a.label, kind: "approval" as const })),
  ];
  try {
    const queue = await automationRepo().listQueue(tenant, 60);
    for (const q of queue.filter((x) => x.state === "upcoming" && x.at >= now).slice(0, 20)) {
      items.push({ at: q.at, label: `Automated post to ${q.platform}`, kind: "automation" });
    }
  } catch { /* automation unavailable */ }

  const tomorrowEnd = dayEnd + DAY;
  const weekEnd = dayStart + 7 * DAY;
  const upcoming: UpcomingSection = {
    today: items.filter((i) => i.at < dayEnd).sort((a, b) => a.at - b.at),
    tomorrow: items.filter((i) => i.at >= dayEnd && i.at < tomorrowEnd).sort((a, b) => a.at - b.at),
    thisWeek: items.filter((i) => i.at >= tomorrowEnd && i.at < weekEnd).sort((a, b) => a.at - b.at),
  };

  const approvals: ApprovalsSection = { count: approvalItems.length, items: approvalItems.slice(0, 5) };

  const hasContent = publishing.today > 0 || upcomingJobs.length > 0 || (plan?.campaigns.length ?? 0) > 0;
  const quiet = connected.length === 0 && !hasContent && activity.length === 0;

  const recommendation = recommend({
    publishing, campaigns, market, performance, approvals,
    connectedPlatforms: connected, hasContent,
  });

  const brief: DailyBrief = {
    tenant,
    company: opts.company ?? plan?.mission ?? "there",
    greeting: greetingFor(now),
    summary: "",                 // filled by the summary step
    summarySource: "deterministic",
    publishing, campaigns, market, performance, approvals,
    recommendation, activity: activity.slice(0, 10), upcoming, quiet,
    generatedAt: now,
    signature: "",
  };
  brief.signature = fingerprint(brief);
  return brief;
}

/**
 * A fingerprint of everything the brief depends on.
 *
 * The cache is invalidated by comparing this rather than by wiring a hook into publishing,
 * campaigns, market, learning and approvals separately. Five hooks is five chances to
 * forget one; a fingerprint over the inputs cannot miss a change it can see.
 *
 * `generatedAt` is excluded — the time is not an input.
 */
export function fingerprint(b: DailyBrief): string {
  const parts = [
    b.publishing.today, b.publishing.awaitingApproval, b.publishing.failed, b.publishing.retryable, b.publishing.nextAt,
    b.campaigns.running, b.campaigns.completed, b.campaigns.blocked,
    b.campaigns.lines.map((l) => `${l.id}:${l.health}:${l.percent}`).join(","),
    b.market.trends.join(","), b.market.competitors.join(","), b.market.opportunities.join(","),
    b.performance.bestPlatform, b.performance.winningFormat,
    b.performance.detail.map((d) => `${d.label}=${d.value}`).join(","),
    b.approvals.count,
    b.activity[0]?.at ?? 0,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}
