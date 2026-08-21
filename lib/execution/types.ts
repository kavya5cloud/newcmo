// Milestone 14 — AI Campaign Execution Engine contracts.
//
// The Launch Workspace plans; this layer *runs*. It owns no orchestration of its own: every
// step delegates to the service that already does that work (Publishing, Job Engine,
// Learning, Market Intelligence, Content Studio). What lives here is the state of a run —
// which step a campaign is on, why it's stuck, and what happened.

/** The one workflow Populr executes, in order. Each step delegates; none re-implements. */
export const WORKFLOW_STEPS = [
  "mission", "research", "market_intelligence", "site_audit", "campaign_planning",
  // Editing sits between writing and publishing, which is the only position that makes it a
  // gate rather than a critic. After publishing it would be a review of work already sent.
  "asset_generation", "copy_generation", "editing", "platform_optimization", "approval",
  "publishing", "analytics", "learning", "optimization",
] as const;
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

export const STEP_LABEL: Record<WorkflowStep, string> = {
  mission: "Mission", research: "Research", market_intelligence: "Market intelligence",
  site_audit: "Site audit",
  campaign_planning: "Campaign planning", asset_generation: "Asset generation",
  copy_generation: "Copy generation", editing: "Editing", platform_optimization: "Platform optimisation",
  approval: "Approval", publishing: "Publishing", analytics: "Analytics",
  learning: "Learning", optimization: "Optimise remaining campaign",
};

export const STEP_STATUSES = [
  "pending", "running", "completed", "failed", "paused", "cancelled", "waiting_approval", "skipped",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** Actions a caller (or the engine) can apply to a step. */
export const STEP_ACTIONS = [
  "execute", "complete", "fail", "pause", "resume", "retry", "skip", "cancel",
  "request_approval", "approve", "reject",
] as const;
export type StepAction = (typeof STEP_ACTIONS)[number];

export type StepState = {
  step: WorkflowStep;
  status: StepStatus;
  attempts: number;
  startedAt: number | null;
  completedAt: number | null;
  /** Why it is where it is — always human-readable, never a bare code. */
  note: string | null;
  error: string | null;
};

/** How much autonomy the engine has for a campaign. */
export const EXECUTION_MODES = ["approval", "automatic", "scheduled"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const CAMPAIGN_EXECUTION_STATUSES = [
  "idle", "running", "paused", "waiting_approval", "completed", "failed", "cancelled",
] as const;
export type CampaignExecutionStatus = (typeof CAMPAIGN_EXECUTION_STATUSES)[number];

export type CampaignExecution = {
  campaignId: string;
  mode: ExecutionMode;
  status: CampaignExecutionStatus;
  steps: StepState[];
  /** Epoch ms the campaign is allowed to start (scheduled mode). */
  startAfter: number | null;
  /** Cadence in days for a recurring campaign; null = one-off. */
  recurEveryDays: number | null;
  runCount: number;
  createdAt: number;
  updatedAt: number;
};

export type ExecutionState = {
  tenant: string;
  launchId: string;
  campaigns: Record<string, CampaignExecution>;
  /** Campaign ids waiting for a slot, in order. */
  queue: string[];
  /** Emergency stop halts everything and blocks new runs until explicitly cleared. */
  emergencyStopped: boolean;
  updatedAt: number;
};

// ---- Health ----

export const HEALTH_STATUSES = ["healthy", "needs_attention", "at_risk", "blocked", "completed"] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export type HealthReason = {
  code:
    | "publishing_failure" | "approval_waiting" | "low_engagement" | "missed_schedule"
    | "competitor_activity" | "disconnected_account" | "execution_failed" | "paused"
    | "not_started" | "on_track" | "complete";
  severity: "low" | "medium" | "high";
  /** Why — stated plainly, with the evidence that produced it. */
  message: string;
  fix: string;
};

export type CampaignHealth = {
  campaignId: string;
  status: HealthStatus;
  /** 0..1 — 1 is perfect health. Derived, never stored as truth. */
  score: number;
  reasons: HealthReason[];
};

// ---- Activity ----

export const ACTIVITY_KINDS = [
  "published", "queued", "asset_generated", "copy_rewritten", "campaign_paused",
  "campaign_resumed", "approval_requested", "approval_granted", "analytics_updated",
  "competitor_detected", "timeline_optimized", "step_started", "step_completed",
  "step_failed", "step_skipped", "run_started", "run_completed", "emergency_stop",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type ActivityEvent = {
  id: string;
  tenant: string;
  launchId: string;
  campaignId: string | null;
  kind: ActivityKind;
  message: string;
  at: number;
  meta: Record<string, string | number | boolean | null>;
};

// ---- Notifications ----

export const NOTIFICATION_KINDS = [
  "best_time", "competitor_launch", "predicted_underperformance", "reschedule_suggestion",
  "approval_required", "publishing_failed", "ahead_of_schedule", "behind_schedule", "account_disconnected",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type Notification = {
  id: string;
  tenant: string;
  launchId: string;
  campaignId: string | null;
  kind: NotificationKind;
  severity: "info" | "warn" | "critical";
  title: string;
  body: string;
  /** What "Act" does — a command-bar string the existing command API already understands. */
  action: string | null;
  detail: string[];
  at: number;
  dismissedAt: number | null;
};

// ---- Adaptive timeline ----

export const ADAPTATION_TYPES = [
  "move_campaign", "delay_post", "accelerate_launch", "generate_asset", "response_campaign",
] as const;
export type AdaptationType = (typeof ADAPTATION_TYPES)[number];

export type AdaptationProposal = {
  id: string;
  type: AdaptationType;
  campaignId: string | null;
  title: string;
  rationale: string;
  /** Concrete observed facts behind the proposal — auditable, not vibes. */
  evidence: string[];
  confidence: number;
  /** Proposals are never applied automatically; this records the decision. */
  status: "proposed" | "approved" | "rejected";
  decidedAt: number | null;
};
