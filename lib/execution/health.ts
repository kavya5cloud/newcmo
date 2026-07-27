import type { CampaignExecution, CampaignHealth, HealthReason, HealthStatus } from "./types";

// CampaignHealthService — continuous, explained health.
//
// A status without a reason is useless, so health is computed as a list of concrete reasons
// (each with the fix) and the status falls out of the worst one. Thin evidence produces
// "not started", never a confident green.

export type HealthInputs = {
  campaignId: string;
  execution: CampaignExecution | null;
  /** Plan progress from the Launch Workspace overlay. */
  itemsTotal: number;
  itemsDone: number;
  /** Publishing facts from the Cross-Platform Publishing System. */
  failedJobs: number;
  connectedAccounts: number;
  /** Channels the campaign plans to use — a channel with no account is blocked, not risky. */
  plannedChannels: number;
  /** Day offset of the next scheduled publish, and the day the launch is on now. */
  nextPublishDay: number | null;
  currentDay: number;
  /** Observed engagement 0..1 from the Learning Engine; null when nothing is measured yet. */
  engagement: number | null;
  /** Competitor moves observed by Market Intelligence in the last window. */
  competitorMoves: string[];
};

const PENALTY: Record<HealthReason["severity"], number> = { low: 0.08, medium: 0.2, high: 0.45 };

const RANK: Record<HealthStatus, number> = { completed: 0, healthy: 1, needs_attention: 2, at_risk: 3, blocked: 4 };

export class CampaignHealthService {
  assess(input: HealthInputs): CampaignHealth {
    const reasons: HealthReason[] = [];
    const exec = input.execution;

    if (input.failedJobs > 0) {
      reasons.push({
        code: "publishing_failure", severity: "high",
        message: `${input.failedJobs} publish${input.failedJobs === 1 ? "" : "es"} failed on the platform side.`,
        fix: "Retry the failed jobs from Publishing — the adapters keep their backoff state.",
      });
    }

    if (input.plannedChannels > 0 && input.connectedAccounts === 0) {
      reasons.push({
        code: "disconnected_account", severity: "high",
        message: "No platform accounts are connected, so nothing can publish.",
        fix: "Connect at least one account in Cross-Post, then re-run the campaign.",
      });
    }

    const waiting = exec?.steps.filter((s) => s.status === "waiting_approval").length ?? 0;
    if (waiting > 0) {
      reasons.push({
        code: "approval_waiting", severity: "medium",
        message: `${waiting} step${waiting === 1 ? "" : "s"} held for approval.`,
        fix: "Approve or skip the held step to let the run continue.",
      });
    }

    if (exec?.steps.some((s) => s.status === "failed")) {
      const failed = exec.steps.filter((s) => s.status === "failed");
      reasons.push({
        code: "execution_failed", severity: "high",
        message: `Execution stopped at ${failed.map((s) => s.step.replace(/_/g, " ")).join(", ")}.`,
        fix: "Retry the failed step, or skip it if it is no longer needed.",
      });
    }

    if (exec?.status === "paused") {
      reasons.push({
        code: "paused", severity: "low",
        message: "The campaign is paused — nothing is running.",
        fix: "Resume it when you're ready.",
      });
    }

    if (input.nextPublishDay != null && input.nextPublishDay < input.currentDay) {
      const late = input.currentDay - input.nextPublishDay;
      reasons.push({
        code: "missed_schedule", severity: late > 2 ? "high" : "medium",
        message: `Next publish was due on day ${input.nextPublishDay}; the launch is on day ${input.currentDay}.`,
        fix: "Publish now, or move the remaining schedule forward.",
      });
    }

    if (input.engagement != null && input.engagement < 0.35) {
      reasons.push({
        code: "low_engagement", severity: "medium",
        message: `Observed engagement is ${Math.round(input.engagement * 100)}% of target.`,
        fix: "Check the Learning panel for the patterns that are working, and rewrite the weakest posts.",
      });
    }

    if (input.competitorMoves.length > 0) {
      reasons.push({
        code: "competitor_activity", severity: "low",
        message: `Competitor activity detected: ${input.competitorMoves.slice(0, 2).join("; ")}.`,
        fix: "Review the adaptive suggestions — a response campaign may be worth approving.",
      });
    }

    const allDone = input.itemsTotal > 0 && input.itemsDone === input.itemsTotal;
    if (allDone && reasons.length === 0) {
      return { campaignId: input.campaignId, status: "completed", score: 1, reasons: [{
        code: "complete", severity: "low", message: "Every planned item is done.", fix: "Review performance and fold the learnings into the next launch.",
      }] };
    }

    if (reasons.length === 0) {
      const started = (exec && exec.status !== "idle") || input.itemsDone > 0;
      return {
        campaignId: input.campaignId,
        status: started ? "healthy" : "needs_attention",
        score: started ? 1 : 0.7,
        reasons: [started
          ? { code: "on_track", severity: "low", message: "Running with no blockers.", fix: "Nothing to do." }
          : { code: "not_started", severity: "low", message: "The campaign hasn't started yet.", fix: "Run the campaign to begin execution." }],
      };
    }

    const score = Math.max(0, Math.min(1, 1 - reasons.reduce((n, r) => n + PENALTY[r.severity], 0)));
    const blocked = reasons.some((r) => r.code === "disconnected_account" || r.code === "execution_failed");
    const status: HealthStatus = blocked ? "blocked"
      : reasons.some((r) => r.severity === "high") ? "at_risk"
        : "needs_attention";

    return {
      campaignId: input.campaignId,
      status,
      score: Number(score.toFixed(3)),
      reasons: reasons.sort((a, b) => PENALTY[b.severity] - PENALTY[a.severity]),
    };
  }

  /** The worst health across campaigns — what the workspace header should show. */
  overall(healths: CampaignHealth[]): HealthStatus {
    if (healths.length === 0) return "needs_attention";
    return healths.reduce<HealthStatus>((worst, h) => (RANK[h.status] > RANK[worst] ? h.status : worst), "completed");
  }
}
