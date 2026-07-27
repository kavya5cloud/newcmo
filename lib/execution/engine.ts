import type { LaunchPlan } from "@/lib/launch/types";
import { ApprovalCoordinator } from "./approval";
import { activityEvent, InMemoryExecutionHistory, type ExecutionHistoryStore } from "./history";
import {
  applyStep, currentStep, deriveStatus, newSteps, nextStep, progress,
} from "./state-machine";
import { WorkflowCoordinator, referenceServices, type ExecutionServices } from "./workflow";
import {
  WORKFLOW_STEPS,
  type ActivityKind, type CampaignExecution, type ExecutionMode, type ExecutionState,
  type StepAction, type WorkflowStep,
} from "./types";

// CampaignExecutionEngine — runs campaigns through the workflow.
//
// This is the *only* orchestration layer for execution. It owns no queue of its own beyond
// which campaign is next, no retry policy beyond the step's own, and no publishing logic at
// all: the Job Engine, the Publishing Engine and the Learning Engine already do that work
// and this engine calls them through the WorkflowCoordinator.

export type EngineOptions = {
  services?: ExecutionServices;
  history?: ExecutionHistoryStore;
  now?: () => number;
  /** How many campaigns may run at once; the rest wait in the queue. */
  concurrency?: number;
  /** Reads the workspace automation toggle so approval behaviour matches the UI. */
  approvalWorkflowEnabled?: () => boolean;
};

export function emptyExecutionState(tenant: string, launchId: string, now = Date.now()): ExecutionState {
  return { tenant, launchId, campaigns: {}, queue: [], emergencyStopped: false, updatedAt: now };
}

export function newCampaignExecution(campaignId: string, mode: ExecutionMode, now: number): CampaignExecution {
  return {
    campaignId, mode, status: "idle", steps: newSteps(),
    startAfter: null, recurEveryDays: null, runCount: 0, createdAt: now, updatedAt: now,
  };
}

export type RunResult = {
  ok: boolean;
  state: ExecutionState;
  /** Steps that actually ran in this call, in order. */
  ran: WorkflowStep[];
  /** Why the run stopped: finished, awaiting approval, failed, queued, or halted. */
  stopped: "completed" | "waiting_approval" | "failed" | "queued" | "paused" | "emergency_stopped" | "scheduled";
  message: string;
};

export class CampaignExecutionEngine {
  readonly workflow: WorkflowCoordinator;
  readonly approvals: ApprovalCoordinator;
  readonly history: ExecutionHistoryStore;
  private now: () => number;
  private concurrency: number;

  constructor(opts: EngineOptions = {}) {
    this.workflow = new WorkflowCoordinator(opts.services ?? referenceServices());
    this.approvals = new ApprovalCoordinator({ approvalWorkflowEnabled: opts.approvalWorkflowEnabled ?? (() => true) });
    this.history = opts.history ?? new InMemoryExecutionHistory();
    this.now = opts.now ?? Date.now;
    this.concurrency = opts.concurrency ?? 2;
  }

  private async record(state: ExecutionState, campaignId: string | null, kind: ActivityKind, message: string, meta: Record<string, string | number | boolean | null> = {}) {
    await this.history.append(activityEvent({
      tenant: state.tenant, launchId: state.launchId, campaignId, kind, message, at: this.now(), meta,
    }));
  }

  private ensure(state: ExecutionState, campaignId: string, mode: ExecutionMode): CampaignExecution {
    const existing = state.campaigns[campaignId];
    if (existing) return existing;
    const created = newCampaignExecution(campaignId, mode, this.now());
    state.campaigns[campaignId] = created;
    return created;
  }

  private runningCount(state: ExecutionState): number {
    return Object.values(state.campaigns).filter((c) => c.status === "running").length;
  }

  private settle(state: ExecutionState, exec: CampaignExecution) {
    exec.status = deriveStatus(exec.steps);
    exec.updatedAt = this.now();
    state.campaigns[exec.campaignId] = exec;
    state.updatedAt = this.now();
  }

  // ---- control ----

  async run(state: ExecutionState, plan: LaunchPlan, campaignId: string, opts: { mode?: ExecutionMode; startAfter?: number | null } = {}): Promise<RunResult> {
    if (state.emergencyStopped) {
      return { ok: false, state, ran: [], stopped: "emergency_stopped", message: "Emergency stop is active. Clear it before running anything." };
    }
    const campaign = plan.campaigns.find((c) => c.id === campaignId);
    if (!campaign) return { ok: false, state, ran: [], stopped: "failed", message: `Unknown campaign ${campaignId}` };

    const exec = this.ensure(state, campaignId, opts.mode ?? "approval");
    if (opts.mode) exec.mode = opts.mode;
    if (opts.startAfter !== undefined) exec.startAfter = opts.startAfter;

    if (exec.mode === "scheduled" && exec.startAfter != null && this.now() < exec.startAfter) {
      this.settle(state, exec);
      return { ok: true, state, ran: [], stopped: "scheduled", message: `Scheduled to start at ${new Date(exec.startAfter).toISOString()}.` };
    }

    if (exec.status !== "running" && this.runningCount(state) >= this.concurrency) {
      if (!state.queue.includes(campaignId)) state.queue.push(campaignId);
      state.updatedAt = this.now();
      await this.record(state, campaignId, "run_started", `${campaign.title} queued — ${this.concurrency} campaigns already running`, { position: state.queue.indexOf(campaignId) + 1 });
      return { ok: true, state, ran: [], stopped: "queued", message: `Queued at position ${state.queue.indexOf(campaignId) + 1}.` };
    }
    state.queue = state.queue.filter((id) => id !== campaignId);

    if (exec.runCount === 0) await this.record(state, campaignId, "run_started", `${campaign.title}: execution started`);
    exec.runCount += 1;

    const ran: WorkflowStep[] = [];
    for (;;) {
      const next = nextStep(exec);
      if (!next) break;

      const approvalGranted = exec.steps.some((s) => s.step === "approval" && s.status === "completed");
      const gate = this.approvals.decide(next.step, exec.mode, approvalGranted);
      if (gate.required) {
        const held = applyStep(next, "request_approval", { now: this.now(), note: gate.reason });
        if (held.ok) this.replace(exec, held.step);
        this.settle(state, exec);
        await this.record(state, campaignId, "approval_requested", `${campaign.title}: ${this.workflow.label(next.step)} is waiting for approval`);
        return { ok: true, state, ran, stopped: "waiting_approval", message: gate.reason };
      }

      const started = applyStep(next, "execute", { now: this.now() });
      if (!started.ok) break;
      this.replace(exec, started.step);
      this.settle(state, exec);
      await this.record(state, campaignId, "step_started", `${campaign.title}: ${this.workflow.label(next.step)} started`, { step: next.step });

      const outcome = await this.workflow.run(next.step, {
        tenant: state.tenant, launchId: state.launchId, campaignId, plan, campaign, now: this.now(),
      });

      const finished = applyStep(started.step, outcome.ok ? "complete" : "fail", {
        now: this.now(), note: outcome.note, error: outcome.error,
      });
      if (finished.ok) this.replace(exec, finished.step);
      this.settle(state, exec);
      ran.push(next.step);

      for (const a of outcome.activity ?? []) await this.record(state, campaignId, a.kind, a.message, { step: next.step });

      if (!outcome.ok) {
        await this.record(state, campaignId, "step_failed", `${campaign.title}: ${this.workflow.label(next.step)} failed — ${outcome.error ?? outcome.note}`, { step: next.step });
        return { ok: false, state, ran, stopped: "failed", message: outcome.error ?? outcome.note };
      }
      await this.record(state, campaignId, "step_completed", `${campaign.title}: ${this.workflow.label(next.step)} — ${outcome.note}`, { step: next.step });
    }

    this.settle(state, exec);
    if (exec.status === "completed") {
      await this.record(state, campaignId, "run_completed", `${campaign.title}: execution completed`);
      if (exec.recurEveryDays != null) {
        // Recurring campaigns re-arm rather than re-run inline — the next run is a
        // scheduled decision, not a loop that could spin.
        exec.steps = newSteps();
        exec.status = "idle";
        exec.startAfter = this.now() + exec.recurEveryDays * 86_400_000;
        exec.mode = "scheduled";
        this.settle(state, exec);
      }
    }
    return { ok: true, state, ran, stopped: "completed", message: `Ran ${ran.length} step${ran.length === 1 ? "" : "s"}.` };
  }

  private replace(exec: CampaignExecution, step: CampaignExecution["steps"][number]) {
    exec.steps = exec.steps.map((s) => (s.step === step.step ? step : s));
  }

  /** Apply an action to one step — the timeline's Execute / Pause / Retry / Skip controls. */
  async act(state: ExecutionState, plan: LaunchPlan, campaignId: string, step: WorkflowStep, action: StepAction): Promise<{ ok: boolean; state: ExecutionState; message: string }> {
    const exec = state.campaigns[campaignId];
    if (!exec) return { ok: false, state, message: "That campaign has not been started." };
    const target = exec.steps.find((s) => s.step === step);
    if (!target) return { ok: false, state, message: `Unknown step ${step}` };

    const applied = applyStep(target, action, { now: this.now() });
    if (!applied.ok) return { ok: false, state, message: applied.error };
    this.replace(exec, applied.step);
    this.settle(state, exec);

    const kind: ActivityKind =
      action === "pause" ? "campaign_paused"
        : action === "resume" ? "campaign_resumed"
          : action === "approve" ? "approval_granted"
            : action === "skip" ? "step_skipped"
              : "step_started";
    await this.record(state, campaignId, kind, `${campaignId}: ${this.workflow.label(step)} ${action}`, { step });

    // Approving or resuming should continue the run, not leave it parked on a green light.
    if (action === "approve" || action === "resume" || action === "retry") {
      const done = applyStep(applied.step, "complete", { now: this.now(), note: action === "approve" ? "Approved" : "Resumed" });
      if (done.ok && step === "approval") { this.replace(exec, done.step); this.settle(state, exec); }
      const r = await this.run(state, plan, campaignId);
      return { ok: r.ok, state: r.state, message: r.message };
    }
    return { ok: true, state, message: `${this.workflow.label(step)} ${action}d.` };
  }

  async pauseCampaign(state: ExecutionState, campaignId: string): Promise<ExecutionState> {
    const exec = state.campaigns[campaignId];
    if (!exec) return state;
    exec.steps = exec.steps.map((s) => {
      const r = applyStep(s, "pause", { now: this.now(), note: "Paused by operator" });
      return r.ok ? r.step : s;
    });
    this.settle(state, exec);
    await this.record(state, campaignId, "campaign_paused", `${campaignId}: paused`);
    return state;
  }

  async resumeCampaign(state: ExecutionState, plan: LaunchPlan, campaignId: string): Promise<RunResult> {
    const exec = state.campaigns[campaignId];
    if (!exec) return { ok: false, state, ran: [], stopped: "failed", message: "That campaign has not been started." };
    exec.steps = exec.steps.map((s) => {
      if (s.status !== "paused") return s;
      // A paused step returns to pending so the run picks it up in order, rather than
      // resuming mid-flight work whose side effects we can't see.
      return { ...s, status: "pending", note: "Resumed" };
    });
    this.settle(state, exec);
    await this.record(state, campaignId, "campaign_resumed", `${campaignId}: resumed`);
    return this.run(state, plan, campaignId);
  }

  async retryFailed(state: ExecutionState, plan: LaunchPlan, campaignId: string): Promise<RunResult> {
    const exec = state.campaigns[campaignId];
    if (!exec) return { ok: false, state, ran: [], stopped: "failed", message: "That campaign has not been started." };
    exec.steps = exec.steps.map((s) => (s.status === "failed" ? { ...s, status: "pending", attempts: s.attempts, note: "Retrying" } : s));
    this.settle(state, exec);
    return this.run(state, plan, campaignId);
  }

  async cancelCampaign(state: ExecutionState, campaignId: string): Promise<ExecutionState> {
    const exec = state.campaigns[campaignId];
    if (!exec) return state;
    exec.steps = exec.steps.map((s) => {
      const r = applyStep(s, "cancel", { now: this.now(), note: "Cancelled by operator" });
      return r.ok ? r.step : s;
    });
    state.queue = state.queue.filter((id) => id !== campaignId);
    this.settle(state, exec);
    await this.record(state, campaignId, "campaign_paused", `${campaignId}: cancelled`);
    return state;
  }

  /** Emergency stop — halts everything and blocks new runs until explicitly cleared. */
  async emergencyStop(state: ExecutionState): Promise<ExecutionState> {
    state.emergencyStopped = true;
    for (const id of Object.keys(state.campaigns)) await this.pauseCampaign(state, id);
    state.queue = [];
    state.updatedAt = this.now();
    await this.record(state, null, "emergency_stop", "Emergency stop — every campaign halted");
    return state;
  }

  async clearEmergencyStop(state: ExecutionState): Promise<ExecutionState> {
    state.emergencyStopped = false;
    state.updatedAt = this.now();
    await this.record(state, null, "campaign_resumed", "Emergency stop cleared");
    return state;
  }

  setMode(state: ExecutionState, campaignId: string, mode: ExecutionMode): ExecutionState {
    const exec = this.ensure(state, campaignId, mode);
    exec.mode = mode;
    this.settle(state, exec);
    return state;
  }

  setRecurrence(state: ExecutionState, campaignId: string, everyDays: number | null): ExecutionState {
    const exec = this.ensure(state, campaignId, "scheduled");
    exec.recurEveryDays = everyDays;
    this.settle(state, exec);
    return state;
  }

  /** Start the next queued campaign if a slot freed up. */
  async drainQueue(state: ExecutionState, plan: LaunchPlan): Promise<ExecutionState> {
    while (state.queue.length > 0 && this.runningCount(state) < this.concurrency && !state.emergencyStopped) {
      const id = state.queue.shift()!;
      await this.run(state, plan, id);
    }
    return state;
  }

  // ---- derived views ----

  view(exec: CampaignExecution) {
    return {
      campaignId: exec.campaignId,
      status: exec.status,
      mode: exec.mode,
      progress: Number(progress(exec).toFixed(3)),
      currentStep: currentStep(exec),
      nextStep: nextStep(exec),
      steps: exec.steps,
      awaitingApproval: this.approvals.pending(exec).length,
      runCount: exec.runCount,
      startAfter: exec.startAfter,
      recurEveryDays: exec.recurEveryDays,
      /** Rough estimate: remaining steps × the average observed step duration. */
      estimatedCompletion: estimate(exec, this.now()),
    };
  }
}

/** Estimated completion from observed step durations — null until something has run. */
export function estimate(exec: CampaignExecution, now: number): number | null {
  const done = exec.steps.filter((s) => s.startedAt != null && s.completedAt != null);
  if (done.length === 0) return null;
  const avg = done.reduce((n, s) => n + (s.completedAt! - s.startedAt!), 0) / done.length;
  const remaining = exec.steps.filter((s) => s.status === "pending" || s.status === "running" || s.status === "waiting_approval").length;
  if (remaining === 0) return null;
  return Math.round(now + avg * remaining);
}

export { WORKFLOW_STEPS };
