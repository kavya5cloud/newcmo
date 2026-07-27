import type { CampaignExecution, ExecutionMode, StepState, WorkflowStep } from "./types";

// ApprovalCoordinator — decides when a run must stop and wait for a human.
//
// The rule is deliberately conservative: publishing is irreversible, so in approval mode a
// run halts before it, and in automatic mode it only proceeds when the operator has turned
// that off explicitly. Nothing here can be bypassed by a step handler.

/** Steps that put work in front of an audience and therefore cannot be undone. */
export const IRREVERSIBLE_STEPS: WorkflowStep[] = ["publishing"];

export type ApprovalDecision = {
  required: boolean;
  reason: string;
};

export class ApprovalCoordinator {
  constructor(private opts: { approvalWorkflowEnabled: () => boolean } = { approvalWorkflowEnabled: () => true }) {}

  /**
   * Should this step wait for a human before running?
   *
   * `approvalGranted` is whether the run's own approval step has already been approved —
   * without it, approval mode would stop twice in a row (once at the gate, once at the
   * publish it was gating), which trains people to click through approvals.
   */
  decide(step: WorkflowStep, mode: ExecutionMode, approvalGranted = false): ApprovalDecision {
    if (step === "approval") {
      if (mode === "automatic" && !this.opts.approvalWorkflowEnabled()) {
        return { required: false, reason: "Automatic mode with the approval workflow turned off." };
      }
      return { required: true, reason: "Approval gate — the run holds here until you approve it." };
    }
    if (IRREVERSIBLE_STEPS.includes(step) && mode === "approval" && !approvalGranted) {
      return { required: true, reason: "Publishing is irreversible; approval mode holds it for review." };
    }
    return { required: false, reason: "" };
  }

  /** Steps currently blocking a campaign on a human. */
  pending(exec: CampaignExecution): StepState[] {
    return exec.steps.filter((s) => s.status === "waiting_approval");
  }

  awaitingCount(execs: CampaignExecution[]): number {
    return execs.reduce((n, e) => n + this.pending(e).length, 0);
  }
}
