import { createHash } from "node:crypto";
import type { WorkflowStep } from "@/lib/execution/types";
import { AGENTS } from "./agents";
import { AGENT_DEPENDENCIES, AGENT_PROFILES, agentForStep } from "./registry";
import type { AgentId, AgentTask, SharedContext, TeamState } from "./types";

// AgentRunner — the single door between the Execution Engine and the team.
//
// It is deliberately not an orchestrator: it does not decide what runs next, it does not
// chain agents, and it has no queue. The Execution Engine hands it one step; it finds the
// agent that owns that step, checks operator controls, runs it once, and records what
// happened. That record is the whole transparency story — task, reasoning, confidence,
// dependencies, duration.

let seq = 0;

function taskId(ctx: SharedContext, agent: AgentId, step: WorkflowStep, now: number): string {
  return "atk_" + createHash("sha256")
    .update(`${ctx.tenant}|${ctx.launchId}|${ctx.campaignId}|${agent}|${step}|${now}|${seq++}`)
    .digest("hex").slice(0, 16);
}

export type RunAgentResult = {
  /** Null when the step is an engine gate (mission, approval) with no agent behind it. */
  task: AgentTask | null;
  /** Why the runner refused, when it did. */
  blocked: "paused" | "awaiting_approval" | null;
};

export class AgentRunner {
  constructor(private now: () => number = Date.now) {}

  /**
   * Run the agent that owns `step`, honouring operator controls first.
   *
   * A paused agent does not run and does not fail — the step is held, so resuming picks up
   * exactly where it stopped rather than replaying side effects.
   */
  async run(state: TeamState, ctx: SharedContext, step: WorkflowStep): Promise<RunAgentResult> {
    const id = agentForStep(step);
    if (!id) return { task: null, blocked: null };

    if (state.controls.paused[id]) return { task: null, blocked: "paused" };

    const startedAt = this.now();
    const base: AgentTask = {
      id: taskId(ctx, id, step, startedAt),
      tenant: ctx.tenant, launchId: ctx.launchId, campaignId: ctx.campaignId,
      agent: id, step, status: "running",
      task: `${AGENT_PROFILES[id].name} working`, reasoning: "", confidence: 0,
      outputs: [], dependsOn: AGENT_DEPENDENCIES[id],
      startedAt, completedAt: null, durationMs: null, error: null,
      decision: null, decidedAt: null,
    };

    let outcome;
    try {
      outcome = await AGENTS[id].run(ctx, step);
    } catch (e) {
      // An agent throwing is a failed task, not a crashed run — the Execution Engine
      // decides whether to retry it.
      const completedAt = this.now();
      const failed: AgentTask = {
        ...base, status: "failed", task: `${AGENT_PROFILES[id].name} failed`,
        reasoning: "The agent raised an error before it could finish. Nothing it may have started is assumed to have completed.",
        confidence: 0, completedAt, durationMs: completedAt - startedAt, error: String(e).slice(0, 200),
      };
      state.tasks.push(failed);
      state.updatedAt = completedAt;
      return { task: failed, blocked: null };
    }

    const completedAt = this.now();
    const needsApproval = Boolean(state.controls.requiresApproval[id]) && outcome.ok;
    const task: AgentTask = {
      ...base,
      status: !outcome.ok ? "failed" : needsApproval ? "waiting_approval" : "completed",
      task: outcome.task,
      reasoning: outcome.reasoning,
      confidence: outcome.confidence,
      outputs: outcome.outputs,
      completedAt,
      durationMs: completedAt - startedAt,
      error: outcome.error ?? null,
    };

    state.tasks.push(task);
    state.updatedAt = completedAt;
    return { task, blocked: needsApproval ? "awaiting_approval" : null };
  }
}

/** Record a human decision on an agent's work. Pure — returns a new state. */
export function decideTask(state: TeamState, taskIdentifier: string, decision: "approved" | "dismissed", now: number): TeamState {
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskIdentifier
      ? { ...t, decision, decidedAt: now, status: decision === "approved" ? "completed" : t.status }
      : t)),
    updatedAt: now,
  };
}

export function setPaused(state: TeamState, agent: AgentId, paused: boolean, now: number): TeamState {
  return { ...state, controls: { ...state.controls, paused: { ...state.controls.paused, [agent]: paused } }, updatedAt: now };
}

export function setRequiresApproval(state: TeamState, agent: AgentId, required: boolean, now: number): TeamState {
  return {
    ...state,
    controls: { ...state.controls, requiresApproval: { ...state.controls.requiresApproval, [agent]: required } },
    updatedAt: now,
  };
}

/** Clear a failed task so the Execution Engine's retry runs the agent cleanly. */
export function clearFailures(state: TeamState, agent: AgentId, now: number): TeamState {
  return { ...state, tasks: state.tasks.filter((t) => !(t.agent === agent && t.status === "failed")), updatedAt: now };
}
