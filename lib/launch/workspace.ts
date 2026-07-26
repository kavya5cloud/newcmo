import type { LaunchPlan, TimelineItem } from "./types";

// Launch Workspace state — the layer that makes an existing LaunchPlan *actionable*.
//
// The plan itself stays deterministic and immutable-by-derivation (Launch Engine owns it).
// What a founder does day to day — marking work done, pausing an item, editing the mission,
// flipping automation on — is execution state, so it lives here, keyed by asset key, and is
// merged over the plan at read time. Nothing in this file re-plans anything.

export const ITEM_STATUSES = ["todo", "in_progress", "done", "paused"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_ACTIONS = ["start", "complete", "pause", "resume", "reset"] as const;
export type ItemAction = (typeof ITEM_ACTIONS)[number];

/** Toggles that describe how much of the launch Populr is allowed to run unattended. */
export const AUTOMATION_KEYS = [
  "autoScheduling", "crossPlatformPublishing", "automaticRetries",
  "approvalWorkflow", "campaignExecution", "bestTimeOptimization", "recurringCampaigns",
] as const;
export type AutomationKey = (typeof AUTOMATION_KEYS)[number];
export type Automation = Record<AutomationKey, boolean>;

export const AUTOMATION_META: Record<AutomationKey, { label: string; description: string }> = {
  autoScheduling: { label: "Auto scheduling", description: "Populr places approved assets into open slots on the plan's timeline." },
  crossPlatformPublishing: { label: "Cross-platform publishing", description: "One approved post fans out to every connected platform." },
  automaticRetries: { label: "Automatic retries", description: "Failed publishes are retried with backoff instead of waiting for you." },
  approvalWorkflow: { label: "Approval workflow", description: "Assets stop at approval before anything goes live." },
  campaignExecution: { label: "Campaign execution", description: "Populr advances campaign items as their dependencies clear." },
  bestTimeOptimization: { label: "Best-time optimisation", description: "Scheduled posts move to the best observed slot for each platform." },
  recurringCampaigns: { label: "Recurring campaigns", description: "Evergreen campaigns re-run on their cadence after the launch." },
};

export function defaultAutomation(): Automation {
  return {
    autoScheduling: true, crossPlatformPublishing: true, automaticRetries: true,
    approvalWorkflow: true, campaignExecution: false, bestTimeOptimization: false, recurringCampaigns: false,
  };
}

/** Mission fields a founder can edit without invalidating the plan's structure. */
export type MissionEdit = {
  mission?: string;
  objectives?: { id: string; statement: string; kpi?: string }[];
  kpis?: { metric: string; target: string; timeframe: string }[];
  successMetrics?: string[];
};

export type WorkspaceState = {
  workspaceKey: string;
  launchId: string;
  items: Record<string, ItemStatus>;   // assetKey → status
  automation: Automation;
  mission: MissionEdit;
  updatedAt: number;
};

export function emptyState(workspaceKey: string, launchId: string, now = Date.now()): WorkspaceState {
  return { workspaceKey, launchId, items: {}, automation: defaultAutomation(), mission: {}, updatedAt: now };
}

const NEXT: Record<ItemAction, ItemStatus | null> = {
  start: "in_progress", complete: "done", pause: "paused", resume: "in_progress", reset: null,
};

export function isItemAction(v: unknown): v is ItemAction {
  return typeof v === "string" && (ITEM_ACTIONS as readonly string[]).includes(v);
}

/** Apply one action to one item. Returns a new state — never mutates the input. */
export function applyItemAction(state: WorkspaceState, assetKey: string, action: ItemAction, now = Date.now()): WorkspaceState {
  const items = { ...state.items };
  const next = NEXT[action];
  if (next === null) delete items[assetKey]; else items[assetKey] = next;
  return { ...state, items, updatedAt: now };
}

export function setAutomation(state: WorkspaceState, key: AutomationKey, on: boolean, now = Date.now()): WorkspaceState {
  return { ...state, automation: { ...state.automation, [key]: on }, updatedAt: now };
}

export function applyMissionEdit(state: WorkspaceState, edit: MissionEdit, now = Date.now()): WorkspaceState {
  return { ...state, mission: { ...state.mission, ...edit }, updatedAt: now };
}

export function statusOf(state: WorkspaceState, assetKey: string): ItemStatus {
  return state.items[assetKey] ?? "todo";
}

// ---- Derived views (what the dashboard renders) ----

export type CampaignProgress = {
  campaignId: string;
  title: string;
  total: number;
  done: number;
  inProgress: number;
  paused: number;
  percent: number;                       // 0..1
  status: "not_started" | "in_progress" | "paused" | "complete";
  nextPublish: { assetKey: string; label: string; channel: string; dayOffset: number } | null;
  awaitingApproval: number;
  queued: number;
};

/** Every timeline item belonging to a campaign, in plan order. */
function itemsOf(plan: LaunchPlan, campaignId: string): TimelineItem[] {
  return plan.weeks.flatMap((w) => w.items.filter((i) => i.campaignId === campaignId));
}

export function campaignProgress(plan: LaunchPlan, state: WorkspaceState): CampaignProgress[] {
  return plan.campaigns.map((c) => {
    const items = itemsOf(plan, c.id);
    const total = items.length;
    let done = 0, inProgress = 0, paused = 0;
    for (const it of items) {
      const s = statusOf(state, it.assetKey);
      if (s === "done") done++; else if (s === "in_progress") inProgress++; else if (s === "paused") paused++;
    }
    const slots = plan.publishingSchedule.filter((s) => s.assetKey.startsWith(`${c.id}:`));
    const upcoming = slots
      .filter((s) => statusOf(state, s.assetKey) !== "done")
      .sort((a, b) => a.dayOffset - b.dayOffset)[0];

    const status: CampaignProgress["status"] =
      total > 0 && done === total ? "complete"
        : paused > 0 && inProgress === 0 && done === 0 ? "paused"
          : done + inProgress > 0 ? "in_progress" : "not_started";

    return {
      campaignId: c.id, title: c.title, total, done, inProgress, paused,
      percent: total ? done / total : 0,
      status,
      nextPublish: upcoming
        ? { assetKey: upcoming.assetKey, label: upcoming.kind.replace(/_/g, " "), channel: upcoming.channel, dayOffset: upcoming.dayOffset }
        : null,
      awaitingApproval: slots.filter((s) => s.stage === "approval" || s.stage === "creative_review").length,
      queued: slots.filter((s) => s.stage === "scheduled" || s.stage === "publishing").length,
    };
  });
}

export type WorkspaceSummary = {
  totalItems: number;
  done: number;
  inProgress: number;
  paused: number;
  percent: number;
  campaignsComplete: number;
  automationOn: number;
};

export function workspaceSummary(plan: LaunchPlan, state: WorkspaceState): WorkspaceSummary {
  const progress = campaignProgress(plan, state);
  const totalItems = progress.reduce((n, p) => n + p.total, 0);
  const done = progress.reduce((n, p) => n + p.done, 0);
  return {
    totalItems, done,
    inProgress: progress.reduce((n, p) => n + p.inProgress, 0),
    paused: progress.reduce((n, p) => n + p.paused, 0),
    percent: totalItems ? done / totalItems : 0,
    campaignsComplete: progress.filter((p) => p.status === "complete").length,
    automationOn: AUTOMATION_KEYS.filter((k) => state.automation[k]).length,
  };
}

/** The mission as the founder currently sees it — plan values with their edits layered on. */
export function effectiveMission(plan: LaunchPlan, state: WorkspaceState) {
  return {
    mission: state.mission.mission ?? plan.mission,
    objectives: state.mission.objectives ?? plan.objectives,
    kpis: state.mission.kpis ?? plan.kpis,
    successMetrics: state.mission.successMetrics ?? plan.kpis.map((k) => `${k.metric} → ${k.target} (${k.timeframe})`),
  };
}
