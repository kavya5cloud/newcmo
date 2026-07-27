import {
  WORKFLOW_STEPS, type CampaignExecution, type CampaignExecutionStatus,
  type StepAction, type StepState, type StepStatus, type WorkflowStep,
} from "./types";

// ExecutionStateMachine — the only place a step's status may change.
//
// Illegal transitions are rejected rather than coerced: a cancelled step must not quietly
// resume, and a completed step must not silently re-run, because both would publish work
// someone thought was settled.

const LEGAL: Record<StepStatus, Partial<Record<StepAction, StepStatus>>> = {
  pending: { execute: "running", skip: "skipped", cancel: "cancelled", pause: "paused", request_approval: "waiting_approval" },
  running: { complete: "completed", fail: "failed", pause: "paused", cancel: "cancelled", request_approval: "waiting_approval", skip: "skipped" },
  waiting_approval: { approve: "running", reject: "cancelled", cancel: "cancelled", pause: "paused", skip: "skipped" },
  paused: { resume: "running", cancel: "cancelled", skip: "skipped" },
  failed: { retry: "running", skip: "skipped", cancel: "cancelled" },
  completed: {},
  cancelled: {},
  skipped: { retry: "running" },
};

export function canApply(status: StepStatus, action: StepAction): boolean {
  return LEGAL[status][action] !== undefined;
}

export function nextStatus(status: StepStatus, action: StepAction): StepStatus | null {
  return LEGAL[status][action] ?? null;
}

export function newStep(step: WorkflowStep): StepState {
  return { step, status: "pending", attempts: 0, startedAt: null, completedAt: null, note: null, error: null };
}

export function newSteps(): StepState[] {
  return WORKFLOW_STEPS.map(newStep);
}

export type ApplyResult =
  | { ok: true; step: StepState }
  | { ok: false; error: string };

/** Apply one action to one step. Pure: returns a new StepState, never mutates. */
export function applyStep(
  state: StepState,
  action: StepAction,
  ctx: { now: number; note?: string; error?: string } = { now: 0 },
): ApplyResult {
  const next = nextStatus(state.status, action);
  if (!next) return { ok: false, error: `cannot ${action} a ${state.status} step` };

  const s: StepState = { ...state, status: next };
  if (action === "execute" || action === "retry" || action === "resume" || action === "approve") {
    s.startedAt = state.startedAt ?? ctx.now;
    s.error = action === "retry" ? state.error : s.error;
    if (action === "retry") s.attempts = state.attempts + 1;
  }
  if (action === "execute") s.attempts = state.attempts + 1;
  if (next === "completed" || next === "skipped" || next === "cancelled") s.completedAt = ctx.now;
  if (action === "fail") { s.error = ctx.error ?? "step failed"; s.completedAt = null; }
  if (action === "complete") s.error = null;
  if (ctx.note !== undefined) s.note = ctx.note;
  return { ok: true, step: s };
}

/** Campaign status is derived from its steps — never stored independently and trusted. */
export function deriveStatus(steps: StepState[]): CampaignExecutionStatus {
  if (steps.some((s) => s.status === "waiting_approval")) return "waiting_approval";
  if (steps.some((s) => s.status === "running")) return "running";
  if (steps.some((s) => s.status === "failed")) return "failed";
  if (steps.some((s) => s.status === "paused")) return "paused";
  const settled = steps.every((s) => s.status === "completed" || s.status === "skipped" || s.status === "cancelled");
  if (settled && steps.some((s) => s.status === "cancelled")) return "cancelled";
  if (settled) return "completed";
  if (steps.every((s) => s.status === "pending")) return "idle";
  return "running";
}

export function currentStep(exec: CampaignExecution): StepState | null {
  return exec.steps.find((s) => s.status === "running" || s.status === "waiting_approval")
    ?? exec.steps.find((s) => s.status === "failed")
    ?? null;
}

export function nextStep(exec: CampaignExecution): StepState | null {
  return exec.steps.find((s) => s.status === "pending") ?? null;
}

export function progress(exec: CampaignExecution): number {
  const settled = exec.steps.filter((s) => s.status === "completed" || s.status === "skipped").length;
  return exec.steps.length ? settled / exec.steps.length : 0;
}
