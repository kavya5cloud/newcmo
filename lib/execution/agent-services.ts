import { assembleContext } from "@/lib/agents/context";
import { AGENT_PROFILES, agentForStep } from "@/lib/agents/registry";
import { teamPlatform } from "@/lib/agents/shared";
import type { AgentTask } from "@/lib/agents/types";
import type { WorkflowStep } from "./types";
import type { ExecutionContext, ExecutionServices, StepOutcome } from "./workflow";

// Milestone 15 wiring — the Execution Engine's workflow steps, performed by the AI team.
//
// The engine still owns orchestration: it decides what runs, in what order, and when to
// stop. This file only answers "who does this step" and translates the agent's record back
// into a step outcome. The agents themselves call the same services the previous direct
// wiring did, so nothing about publishing, generation or learning changed — only who is
// accountable for it, and whether you can watch them do it.

/** Turn an agent's task record into the engine's step outcome. */
function toStepOutcome(task: AgentTask): StepOutcome {
  const activity = task.outputs.length
    ? [{ kind: activityKindFor(task.step), message: `${AGENT_PROFILES[task.agent].name}: ${task.task}` }]
    : undefined;
  return {
    ok: task.status !== "failed",
    // The note is what the workspace shows on the step, so it carries the agent's own
    // words rather than a generic "step completed".
    note: `${AGENT_PROFILES[task.agent].name} — ${task.task}`,
    error: task.error ?? undefined,
    activity,
  };
}

function activityKindFor(step: WorkflowStep) {
  switch (step) {
    case "asset_generation": return "asset_generated" as const;
    case "copy_generation": return "copy_rewritten" as const;
    case "publishing": return "queued" as const;
    case "analytics": return "analytics_updated" as const;
    case "optimization": return "timeline_optimized" as const;
    case "market_intelligence": return "competitor_detected" as const;
    default: return "step_completed" as const;
  }
}

async function runStep(c: ExecutionContext, step: WorkflowStep): Promise<StepOutcome> {
  const id = agentForStep(step);
  if (!id) return { ok: true, note: "No agent owns this step" };

  const p = teamPlatform();
  const state = await p.state.get(c.tenant, c.launchId);

  // One assembled view of the world per step, shared by whichever agent runs it.
  const ctx = await assembleContext({
    tenant: c.tenant, launchId: c.launchId, plan: c.plan, campaign: c.campaign, now: c.now,
  });

  const { task, blocked } = await p.runner.run(state, ctx, step);
  await p.state.save(state);

  if (blocked === "paused") {
    // A paused agent is an operator decision, not a malfunction — the message says exactly
    // that, and says how to continue, because the engine will show this step as stopped.
    return {
      ok: false,
      note: `${AGENT_PROFILES[id].name} is paused`,
      error: `The ${AGENT_PROFILES[id].name} agent is paused. Resume it in the AI Team panel, then retry this step.`,
    };
  }
  if (!task) return { ok: true, note: "Nothing for this step" };

  if (blocked === "awaiting_approval") {
    return {
      ok: false,
      note: `${AGENT_PROFILES[id].name} — awaiting your approval`,
      error: `${AGENT_PROFILES[id].name} finished and its work needs approval before the run continues. Approve it in the AI Team panel, then retry this step.`,
    };
  }

  return toStepOutcome(task);
}

/** The workflow, performed by the team. Shape-compatible with the M14 service surface. */
export function agentServices(): ExecutionServices {
  return {
    research: (c) => runStep(c, "research"),
    marketIntelligence: (c) => runStep(c, "market_intelligence"),
    plan: (c) => runStep(c, "campaign_planning"),
    generate: (c, kind) => runStep(c, kind === "asset" ? "asset_generation" : "copy_generation"),
    optimizeForPlatforms: (c) => runStep(c, "platform_optimization"),
    publish: (c) => runStep(c, "publishing"),
    analytics: (c) => runStep(c, "analytics"),
    learn: (c) => runStep(c, "learning"),
    optimize: (c) => runStep(c, "optimization"),
  };
}
