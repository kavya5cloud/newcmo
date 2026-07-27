import { AGENT_DEPENDENCIES, AGENT_PROFILES, TEAM_ORDER } from "./registry";
import {
  AGENT_IDS,
  type AgentId, type AgentStatus, type AgentSummary, type AgentTask,
  type TeamGraphNode, type TeamState,
} from "./types";

// AgentBoard — the AI Team dashboard, derived.
//
// Nothing here is stored: the board is a projection over the task log and the operator
// controls, so it can never drift from what actually ran. If a number on the panel looks
// wrong, the tasks are the truth and this is just arithmetic over them.

export class AgentBoard {
  /** One row per agent, whether or not it has run. */
  summaries(state: TeamState, campaignId?: string): AgentSummary[] {
    return TEAM_ORDER.map((agent) => {
      const tasks = state.tasks
        .filter((t) => t.agent === agent && (!campaignId || t.campaignId === campaignId))
        .sort((a, b) => a.startedAt - b.startedAt);

      const paused = Boolean(state.controls.paused[agent]);
      const current = tasks.find((t) => t.status === "running")
        ?? tasks.find((t) => t.status === "waiting_approval")
        ?? tasks.find((t) => t.status === "failed")
        ?? null;

      const finished = tasks.filter((t) => t.status === "completed");
      const scored = tasks.filter((t) => t.status === "completed" || t.status === "waiting_approval");
      const timed = tasks.filter((t) => t.durationMs != null);

      const status: AgentStatus =
        paused ? "paused"
          : tasks.some((t) => t.status === "running") ? "running"
            : tasks.some((t) => t.status === "waiting_approval") ? "waiting_approval"
              : tasks.some((t) => t.status === "failed") ? "failed"
                : finished.length > 0 ? "completed"
                  : "idle";

      return {
        agent,
        name: AGENT_PROFILES[agent].name,
        role: AGENT_PROFILES[agent].role,
        status,
        paused,
        currentTask: current,
        completed: finished.length,
        failed: tasks.filter((t) => t.status === "failed").length,
        awaitingApproval: tasks.filter((t) => t.status === "waiting_approval").length,
        avgConfidence: scored.length
          ? Number((scored.reduce((n, t) => n + t.confidence, 0) / scored.length).toFixed(3))
          : null,
        avgDurationMs: timed.length
          ? Math.round(timed.reduce((n, t) => n + (t.durationMs ?? 0), 0) / timed.length)
          : null,
        lastActiveAt: tasks.length ? Math.max(...tasks.map((t) => t.completedAt ?? t.startedAt)) : null,
      };
    });
  }

  /** The execution graph the panel draws — who worked, and on whose output. */
  graph(state: TeamState, campaignId?: string): TeamGraphNode[] {
    const summaries = this.summaries(state, campaignId);
    return TEAM_ORDER.map((agent) => {
      const s = summaries.find((x) => x.agent === agent)!;
      return {
        agent, name: AGENT_PROFILES[agent].name, status: s.status,
        dependsOn: AGENT_DEPENDENCIES[agent],
        taskCount: s.completed + s.failed + s.awaitingApproval,
      };
    });
  }

  /** Work that has finished and hasn't been dismissed — the "completed tasks" feed. */
  completed(state: TeamState, limit = 30, campaignId?: string): AgentTask[] {
    return state.tasks
      .filter((t) => t.status === "completed" && t.decision !== "dismissed" && (!campaignId || t.campaignId === campaignId))
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      .slice(0, limit);
  }

  waitingApproval(state: TeamState, campaignId?: string): AgentTask[] {
    return state.tasks
      .filter((t) => t.status === "waiting_approval" && t.decision == null && (!campaignId || t.campaignId === campaignId))
      .sort((a, b) => a.startedAt - b.startedAt);
  }

  /**
   * The queue: agents that have work coming but haven't produced it yet, in workflow order.
   * A paused agent is listed as blocked rather than pending, so the reason is visible.
   */
  queue(state: TeamState, campaignId?: string): { agent: AgentId; name: string; blocked: boolean }[] {
    const summaries = this.summaries(state, campaignId);
    return summaries
      .filter((s) => s.status === "idle" || s.status === "paused")
      .map((s) => ({ agent: s.agent, name: s.name, blocked: s.paused }));
  }

  /**
   * Recommendations the team has produced. Sourced from agent outputs that are explicitly
   * advisory, so the panel never presents a completed action as something still to decide.
   */
  recommendations(state: TeamState, campaignId?: string): { agent: AgentId; text: string; confidence: number; taskId: string }[] {
    // The same opportunity surfaces on every pass an agent makes over it. Collapse by text
    // and keep the most confident sighting — a wall of repeats reads as noise, not advice.
    const best = new Map<string, { agent: AgentId; text: string; confidence: number; taskId: string }>();
    for (const t of state.tasks) {
      if (t.decision === "dismissed") continue;
      if (campaignId && t.campaignId !== campaignId) continue;
      for (const o of t.outputs) {
        if (!o.startsWith("Recommend — ") && !o.startsWith("Opportunity — ")) continue;
        const text = o.replace(/^(Recommend|Opportunity) — /, "");
        const prev = best.get(text);
        if (!prev || t.confidence > prev.confidence) {
          best.set(text, { agent: t.agent, text, confidence: t.confidence, taskId: t.id });
        }
      }
    }
    return [...best.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 8);
  }

  /** Headline counters for the dashboard. */
  totals(state: TeamState, campaignId?: string) {
    const s = this.summaries(state, campaignId);
    return {
      agents: AGENT_IDS.length,
      running: s.filter((x) => x.status === "running").length,
      paused: s.filter((x) => x.paused).length,
      completedTasks: s.reduce((n, x) => n + x.completed, 0),
      failedTasks: s.reduce((n, x) => n + x.failed, 0),
      awaitingApproval: s.reduce((n, x) => n + x.awaitingApproval, 0),
    };
  }
}
