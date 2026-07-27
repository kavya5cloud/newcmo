import type { LaunchCampaign, LaunchPlan } from "@/lib/launch/types";
import { STEP_LABEL, WORKFLOW_STEPS, type ActivityKind, type WorkflowStep } from "./types";

// WorkflowCoordinator — what each step of the workflow *means*, and who does the work.
//
// Every handler delegates to a service that already exists. If a step needs new behaviour,
// the behaviour belongs in that service, not here. This file only knows the order of the
// steps and how to describe what happened.

export type ExecutionContext = {
  tenant: string;
  launchId: string;
  campaignId: string;
  plan: LaunchPlan;
  campaign: LaunchCampaign;
  now: number;
};

export type StepOutcome = {
  ok: boolean;
  note: string;
  error?: string;
  /** Extra activity to record beyond the step's own start/finish. */
  activity?: { kind: ActivityKind; message: string }[];
};

export type StepHandler = (ctx: ExecutionContext) => Promise<StepOutcome>;

/**
 * The service surface the workflow delegates into. Each member maps to an existing engine;
 * the execution layer never talks to a provider, a platform SDK or a database directly.
 */
export type ExecutionServices = {
  /** Market Intelligence (M13) — research pass for the mission. */
  research(ctx: ExecutionContext): Promise<StepOutcome>;
  /** Market Intelligence (M13) — trends, competitors, opportunities. */
  marketIntelligence(ctx: ExecutionContext): Promise<StepOutcome>;
  /** Job Engine (M11) — background generation work. */
  generate(ctx: ExecutionContext, kind: "asset" | "copy"): Promise<StepOutcome>;
  /** Cross-Platform Publishing (M12) — per-platform constraints. */
  optimizeForPlatforms(ctx: ExecutionContext): Promise<StepOutcome>;
  /** Cross-Platform Publishing (M12) — queue/publish through the adapters. */
  publish(ctx: ExecutionContext): Promise<StepOutcome>;
  /** Cross-Platform Publishing (M12) — observed results. */
  analytics(ctx: ExecutionContext): Promise<StepOutcome>;
  /** Learning Engine (M10) — ingest results so future runs improve. */
  learn(ctx: ExecutionContext): Promise<StepOutcome>;
  /** Market Intelligence + Learning — what to change in the rest of the campaign. */
  optimize(ctx: ExecutionContext): Promise<StepOutcome>;
};

export class WorkflowCoordinator {
  private handlers: Record<WorkflowStep, StepHandler>;

  constructor(private services: ExecutionServices) {
    this.handlers = {
      // Planning steps are already done by the Launch Engine before a run starts —
      // they are recorded as satisfied rather than re-executed, so a run never re-plans
      // work a founder has already reviewed.
      mission: async (c) => ({ ok: true, note: `Mission: ${c.plan.mission}` }),
      research: (c) => this.services.research(c),
      market_intelligence: (c) => this.services.marketIntelligence(c),
      campaign_planning: async (c) => ({
        ok: true,
        note: `${c.campaign.assetPlan.summary.total} assets planned across ${c.campaign.channels.join(", ")}`,
      }),
      asset_generation: (c) => this.services.generate(c, "asset"),
      copy_generation: (c) => this.services.generate(c, "copy"),
      platform_optimization: (c) => this.services.optimizeForPlatforms(c),
      // Approval is a gate, not work: the ApprovalCoordinator decides whether it pauses.
      approval: async () => ({ ok: true, note: "Approved" }),
      publishing: (c) => this.services.publish(c),
      analytics: (c) => this.services.analytics(c),
      learning: (c) => this.services.learn(c),
      optimization: (c) => this.services.optimize(c),
    };
  }

  steps(): readonly WorkflowStep[] { return WORKFLOW_STEPS; }

  label(step: WorkflowStep): string { return STEP_LABEL[step]; }

  async run(step: WorkflowStep, ctx: ExecutionContext): Promise<StepOutcome> {
    try {
      return await this.handlers[step](ctx);
    } catch (e) {
      // A service failing must not take the run process down — the step fails, the campaign
      // reports why, and the operator can retry it.
      return { ok: false, note: `${STEP_LABEL[step]} failed`, error: String(e).slice(0, 200) };
    }
  }
}

/** Deterministic services for tests and for running without external credentials. */
export function referenceServices(): ExecutionServices {
  const ok = (note: string, activity?: StepOutcome["activity"]): StepOutcome => ({ ok: true, note, activity });
  return {
    research: async (c) => ok(`Researched "${c.plan.mission}"`),
    marketIntelligence: async () => ok("Market scanned"),
    generate: async (c, kind) => ok(
      `${kind === "asset" ? "Assets" : "Copy"} generated for ${c.campaign.title}`,
      [{ kind: kind === "asset" ? "asset_generated" : "copy_rewritten", message: `${c.campaign.title}: ${kind} generated` }],
    ),
    optimizeForPlatforms: async (c) => ok(`Optimised for ${c.campaign.channels.join(", ")}`),
    publish: async (c) => ok(`Queued ${c.campaign.channels.length} platform(s)`, [{ kind: "queued", message: `${c.campaign.title} queued` }]),
    analytics: async () => ok("No results observed yet"),
    learn: async () => ok("Nothing new to learn yet"),
    optimize: async () => ok("No changes recommended"),
  };
}
