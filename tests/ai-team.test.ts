import { describe, it, expect } from "vitest";
import { createLaunch } from "@/lib/launch/engine";
import { DEFAULT_LAUNCH } from "@/lib/launch/shared";
import { WORKFLOW_STEPS, type WorkflowStep } from "@/lib/execution/types";
import { AGENT_DEPENDENCIES, AGENT_PROFILES, TEAM_ORDER, agentForStep } from "@/lib/agents/registry";
import { AgentRunner, clearFailures, decideTask, setPaused, setRequiresApproval } from "@/lib/agents/runner";
import { AgentBoard } from "@/lib/agents/board";
import { InMemoryTeamStateRepo } from "@/lib/agents/store";
import { AGENT_IDS, emptyTeamState, type AgentId, type SharedContext, type TeamState } from "@/lib/agents/types";
import type { Agent } from "@/lib/agents/agents";

// Milestone 15 — the AI Marketing Team. Deterministic: a fixed clock and stub agents, so
// what is asserted is the contract between the team and the Execution Engine, not the
// content of any one agent's output.

const plan = createLaunch(DEFAULT_LAUNCH);
const campaign = plan.campaigns[0];

let clock = 1_000;
const now = () => (clock += 10);

const ctx: SharedContext = {
  tenant: "t", launchId: plan.launchId, campaignId: campaign.id,
  brand: { name: "Populr", oneLiner: "an AI CMO", voice: ["direct"] },
  audience: "seed-stage founders",
  campaign: { id: campaign.id, title: campaign.title, goal: campaign.goal, phase: campaign.phase, channels: campaign.channels, assetCount: 12 },
  goals: { objectives: ["Win the launch"], kpis: plan.kpis },
  connectedPlatforms: [{ platform: "linkedin", handle: "@populr", status: "connected" }],
  analytics: { published: 0, failed: 0, scheduled: 0 },
  market: { headline: "h", trends: ["ai cmo (80%)"], competitors: ["Okara: posting daily"], opportunities: ["Own the term → publish a comparison"] },
  previousCampaigns: [], memory: [], now: 5_000,
};

/** A stub agent so the runner's contract is tested, not an agent's judgement. */
function stub(id: AgentId, over: Partial<{ ok: boolean; throws: boolean }> = {}): Agent {
  return {
    id,
    async run() {
      if (over.throws) throw new Error("agent exploded");
      return {
        ok: over.ok ?? true,
        task: `${id} did a thing`,
        reasoning: `${id} reasoned about it`,
        confidence: 0.7,
        outputs: [`Recommend — do the ${id} thing`],
        error: over.ok === false ? "it did not work" : undefined,
      };
    },
  };
}

describe("team roster", () => {
  it("covers every workflow step that is real work", () => {
    // `mission` and `approval` are engine gates, deliberately owned by nobody.
    const gates: WorkflowStep[] = ["mission", "approval"];
    for (const step of WORKFLOW_STEPS) {
      const owner = agentForStep(step);
      if (gates.includes(step)) expect(owner).toBeNull();
      else expect(owner, `no agent owns ${step}`).not.toBeNull();
    }
  });

  it("assigns each step to exactly one agent", () => {
    const seen = new Map<WorkflowStep, AgentId>();
    for (const id of AGENT_IDS) {
      for (const step of AGENT_PROFILES[id].steps) {
        expect(seen.has(step), `${step} owned twice`).toBe(false);
        seen.set(step, id);
      }
    }
  });

  it("has an acyclic dependency chain — no agent waits on itself", () => {
    const index = new Map(TEAM_ORDER.map((a, i) => [a, i]));
    for (const [agent, deps] of Object.entries(AGENT_DEPENDENCIES) as [AgentId, AgentId[]][]) {
      for (const d of deps) {
        expect(index.get(d)!, `${agent} depends on later agent ${d}`).toBeLessThan(index.get(agent)!);
      }
    }
  });

  it("names the services each agent works through, so nothing is re-implemented", () => {
    for (const id of AGENT_IDS) {
      expect(AGENT_PROFILES[id].uses.length).toBeGreaterThan(0);
      expect(AGENT_PROFILES[id].responsibilities.length).toBeGreaterThan(0);
    }
  });
});

describe("agent runner", () => {
  const runner = () => new AgentRunner(now);

  it("records a full transparency trail for a task", async () => {
    const state = emptyTeamState("t", plan.launchId, 0);
    const r = await runner().run(state, ctx, "research");
    const t = r.task!;
    expect(t.agent).toBe("research");
    expect(t.reasoning.length).toBeGreaterThan(0);
    expect(t.confidence).toBeGreaterThan(0);
    expect(t.durationMs).not.toBeNull();
    expect(t.dependsOn).toEqual(AGENT_DEPENDENCIES.research);
    expect(t.status).toBe("completed");
  });

  it("returns nothing for a gate step rather than inventing an owner", async () => {
    const state = emptyTeamState("t", plan.launchId, 0);
    expect((await runner().run(state, ctx, "approval")).task).toBeNull();
    expect(state.tasks).toHaveLength(0);
  });

  it("a paused agent does not run and does not fail", async () => {
    let state = emptyTeamState("t", plan.launchId, 0);
    state = setPaused(state, "research", true, 1);
    const r = await runner().run(state, ctx, "research");
    expect(r.blocked).toBe("paused");
    expect(r.task).toBeNull();
    expect(state.tasks, "a paused agent must leave no task record").toHaveLength(0);
  });

  it("resuming lets the agent run again", async () => {
    let state = emptyTeamState("t", plan.launchId, 0);
    state = setPaused(state, "research", true, 1);
    state = setPaused(state, "research", false, 2);
    expect((await runner().run(state, ctx, "research")).blocked).toBeNull();
  });

  it("holds for approval when the operator requires it", async () => {
    let state = emptyTeamState("t", plan.launchId, 0);
    state = setRequiresApproval(state, "strategy", true, 1);
    const r = await runner().run(state, ctx, "campaign_planning");
    expect(r.blocked).toBe("awaiting_approval");
    expect(r.task!.status).toBe("waiting_approval");
  });

  it("a thrown agent becomes a failed task, not a crashed run", async () => {
    const state = emptyTeamState("t", plan.launchId, 0);
    const boom = new AgentRunner(now);
    // Force the failure path through the real registry by pointing at a throwing stub.
    const original = (await import("@/lib/agents/agents")).AGENTS;
    const saved = original.research;
    original.research = stub("research", { throws: true });
    try {
      const r = await boom.run(state, ctx, "research");
      expect(r.task!.status).toBe("failed");
      expect(r.task!.error).toContain("agent exploded");
      expect(r.task!.confidence).toBe(0);
    } finally {
      original.research = saved;
    }
  });

  it("decisions are recorded without mutating the state given", () => {
    const state: TeamState = {
      ...emptyTeamState("t", plan.launchId, 0),
      tasks: [{
        id: "atk_1", tenant: "t", launchId: plan.launchId, campaignId: campaign.id,
        agent: "content", step: "copy_generation", status: "waiting_approval",
        task: "x", reasoning: "y", confidence: 0.5, outputs: [], dependsOn: [],
        startedAt: 1, completedAt: 2, durationMs: 1, error: null, decision: null, decidedAt: null,
      }],
    };
    const next = decideTask(state, "atk_1", "approved", 99);
    expect(state.tasks[0].decision).toBeNull();
    expect(next.tasks[0].decision).toBe("approved");
    expect(next.tasks[0].status).toBe("completed");
  });

  it("clearing failures removes only that agent's failed tasks", () => {
    const base = emptyTeamState("t", plan.launchId, 0);
    const mk = (agent: AgentId, status: "failed" | "completed") => ({
      id: `atk_${agent}_${status}`, tenant: "t", launchId: plan.launchId, campaignId: campaign.id,
      agent, step: "research" as WorkflowStep, status, task: "", reasoning: "", confidence: 0,
      outputs: [], dependsOn: [], startedAt: 1, completedAt: 2, durationMs: 1,
      error: null, decision: null, decidedAt: null,
    });
    const state: TeamState = { ...base, tasks: [mk("research", "failed"), mk("content", "failed"), mk("research", "completed")] };
    const next = clearFailures(state, "research", 5);
    expect(next.tasks.map((t) => t.id)).toEqual(["atk_content_failed", "atk_research_completed"]);
  });
});

describe("agent board", () => {
  const board = new AgentBoard();

  async function ranState(): Promise<TeamState> {
    const state = emptyTeamState("t", plan.launchId, 0);
    const runner = new AgentRunner(now);
    for (const step of ["research", "campaign_planning", "copy_generation"] as WorkflowStep[]) {
      await runner.run(state, ctx, step);
    }
    return state;
  }

  it("lists every agent, including ones that have not run", async () => {
    const s = board.summaries(await ranState());
    expect(s).toHaveLength(AGENT_IDS.length);
    expect(s.find((x) => x.agent === "analytics")!.status).toBe("idle");
  });

  it("reports confidence and duration only where work exists", async () => {
    const s = board.summaries(await ranState());
    const research = s.find((x) => x.agent === "research")!;
    expect(research.avgConfidence).toBeGreaterThan(0);
    expect(research.avgDurationMs).not.toBeNull();
    const idle = s.find((x) => x.agent === "analytics")!;
    expect(idle.avgConfidence).toBeNull();
    expect(idle.avgDurationMs).toBeNull();
  });

  it("a paused agent reads as paused, not idle", async () => {
    const state = setPaused(await ranState(), "creative", true, 9);
    expect(board.summaries(state).find((x) => x.agent === "creative")!.status).toBe("paused");
    expect(board.queue(state).find((q) => q.agent === "creative")!.blocked).toBe(true);
  });

  it("dismissed work disappears from completed and recommendations", async () => {
    let state = await ranState();
    const first = board.completed(state)[0];
    expect(board.recommendations(state).length).toBeGreaterThan(0);
    state = decideTask(state, first.id, "dismissed", 50);
    expect(board.completed(state).some((t) => t.id === first.id)).toBe(false);
    expect(board.recommendations(state).some((r) => r.taskId === first.id)).toBe(false);
  });

  it("collapses the same recommendation seen on multiple passes", async () => {
    const state = await ranState();
    const recs = board.recommendations(state);
    expect(new Set(recs.map((r) => r.text)).size).toBe(recs.length);
    expect(recs.length).toBeLessThanOrEqual(8);
  });

  it("the graph mirrors the declared dependencies", async () => {
    const g = board.graph(await ranState());
    expect(g.map((n) => n.agent)).toEqual(TEAM_ORDER);
    expect(g.find((n) => n.agent === "content")!.dependsOn).toEqual(AGENT_DEPENDENCIES.content);
  });

  it("totals agree with the summaries they came from", async () => {
    const state = await ranState();
    const t = board.totals(state);
    const s = board.summaries(state);
    expect(t.completedTasks).toBe(s.reduce((n, x) => n + x.completed, 0));
    expect(t.agents).toBe(AGENT_IDS.length);
  });

  it("scopes to one campaign when asked", async () => {
    const state = await ranState();
    expect(board.totals(state, campaign.id).completedTasks).toBeGreaterThan(0);
    expect(board.totals(state, "other_campaign").completedTasks).toBe(0);
  });
});

describe("team store", () => {
  it("round-trips and is scoped per tenant", async () => {
    const repo = new InMemoryTeamStateRepo();
    const state = setPaused(emptyTeamState("a", plan.launchId, 1), "content", true, 2);
    await repo.save(state);
    expect((await repo.get("a", plan.launchId)).controls.paused.content).toBe(true);
    expect((await repo.get("b", plan.launchId)).controls.paused.content).toBeUndefined();
  });
});
