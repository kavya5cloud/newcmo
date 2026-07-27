import { describe, it, expect } from "vitest";
import { createLaunch } from "@/lib/launch/engine";
import { DEFAULT_LAUNCH } from "@/lib/launch/shared";
import { CampaignExecutionEngine, emptyExecutionState, estimate, newCampaignExecution } from "@/lib/execution/engine";
import { applyStep, canApply, deriveStatus, newSteps } from "@/lib/execution/state-machine";
import { ApprovalCoordinator } from "@/lib/execution/approval";
import { CampaignHealthService, type HealthInputs } from "@/lib/execution/health";
import { NotificationService } from "@/lib/execution/notifications";
import { AdaptiveTimeline } from "@/lib/execution/adaptive";
import { InMemoryExecutionHistory } from "@/lib/execution/history";
import { InMemoryExecutionStateRepo, InMemoryNotificationRepo } from "@/lib/execution/store";
import { referenceServices, WorkflowCoordinator, type ExecutionServices } from "@/lib/execution/workflow";

// Milestone 14 — the execution engine. Deterministic throughout: a fixed clock, reference
// services, and no network. What is asserted here is the safety of the machine, not the
// happy path alone: illegal transitions, approval gates, emergency stop, honest health.

const plan = createLaunch(DEFAULT_LAUNCH);
const c0 = plan.campaigns[0].id;
const c1 = plan.campaigns[1].id;

let clock = 1_000;
const now = () => (clock += 1000);
const engine = (over: Partial<ConstructorParameters<typeof CampaignExecutionEngine>[0]> = {}) =>
  new CampaignExecutionEngine({ now, history: new InMemoryExecutionHistory(), ...over });

describe("execution state machine", () => {
  it("refuses illegal transitions instead of coercing them", () => {
    const [step] = newSteps();
    const done = applyStep(step, "execute", { now: 1 });
    expect(done.ok).toBe(true);
    const completed = applyStep(done.ok ? done.step : step, "complete", { now: 2 });
    expect(completed.ok).toBe(true);
    // A completed step is settled — nothing re-runs or cancels it.
    const again = applyStep(completed.ok ? completed.step : step, "execute", { now: 3 });
    expect(again.ok).toBe(false);
    expect(canApply("completed", "cancel")).toBe(false);
    expect(canApply("cancelled", "resume")).toBe(false);
  });

  it("counts an attempt per execute and per retry", () => {
    let s = newSteps()[0];
    s = (applyStep(s, "execute", { now: 1 }) as { step: typeof s }).step;
    s = (applyStep(s, "fail", { now: 2, error: "boom" }) as { step: typeof s }).step;
    expect(s.attempts).toBe(1);
    expect(s.error).toBe("boom");
    s = (applyStep(s, "retry", { now: 3 }) as { step: typeof s }).step;
    expect(s.attempts).toBe(2);
    expect(s.status).toBe("running");
  });

  it("derives campaign status from its steps, worst first", () => {
    const steps = newSteps();
    expect(deriveStatus(steps)).toBe("idle");
    expect(deriveStatus(steps.map((s, i) => (i === 0 ? { ...s, status: "failed" as const } : s)))).toBe("failed");
    expect(deriveStatus(steps.map((s, i) => (i === 0 ? { ...s, status: "waiting_approval" as const } : s)))).toBe("waiting_approval");
    expect(deriveStatus(steps.map((s) => ({ ...s, status: "completed" as const })))).toBe("completed");
  });
});

describe("approval coordinator", () => {
  it("always gates the approval step, and publishing in approval mode", () => {
    const a = new ApprovalCoordinator();
    expect(a.decide("approval", "approval").required).toBe(true);
    expect(a.decide("publishing", "approval").required).toBe(true);
    // ...but not a second time once the run's approval gate has been granted.
    expect(a.decide("publishing", "approval", true).required).toBe(false);
    expect(a.decide("research", "approval").required).toBe(false);
  });

  it("only skips the gate in automatic mode when the workflow is explicitly off", () => {
    expect(new ApprovalCoordinator({ approvalWorkflowEnabled: () => true }).decide("approval", "automatic").required).toBe(true);
    expect(new ApprovalCoordinator({ approvalWorkflowEnabled: () => false }).decide("approval", "automatic").required).toBe(false);
  });
});

describe("campaign execution engine", () => {
  it("runs up to the approval gate and holds there", async () => {
    const e = engine();
    const r = await e.run(emptyExecutionState("t", plan.launchId, 0), plan, c0);
    expect(r.stopped).toBe("waiting_approval");
    expect(r.ran).toEqual(["mission", "research", "market_intelligence", "campaign_planning", "asset_generation", "copy_generation", "platform_optimization"]);
    expect(r.state.campaigns[c0].status).toBe("waiting_approval");
  });

  it("runs to completion once approved", async () => {
    const e = engine();
    let state = (await e.run(emptyExecutionState("t", plan.launchId, 0), plan, c0)).state;
    const r = await e.act(state, plan, c0, "approval", "approve");
    state = r.state;
    expect(state.campaigns[c0].status).toBe("completed");
    expect(state.campaigns[c0].steps.every((s) => s.status === "completed")).toBe(true);
  });

  it("runs everything without a gate in automatic mode with approvals off", async () => {
    const e = engine({ approvalWorkflowEnabled: () => false });
    const r = await e.run(emptyExecutionState("t", plan.launchId, 0), plan, c0, { mode: "automatic" });
    expect(r.stopped).toBe("completed");
    expect(r.state.campaigns[c0].status).toBe("completed");
  });

  it("stops at a failing step and reports why, leaving later steps untouched", async () => {
    const failing: ExecutionServices = {
      ...referenceServices(),
      marketIntelligence: async () => ({ ok: false, note: "Market scan failed", error: "source unavailable" }),
    };
    const e = engine({ services: failing });
    const r = await e.run(emptyExecutionState("t", plan.launchId, 0), plan, c0, { mode: "automatic" });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("source unavailable");
    const steps = r.state.campaigns[c0].steps;
    expect(steps.find((s) => s.step === "market_intelligence")!.status).toBe("failed");
    expect(steps.find((s) => s.step === "publishing")!.status).toBe("pending");
  });

  it("retries only the failed step", async () => {
    let fail = true;
    const flaky: ExecutionServices = {
      ...referenceServices(),
      research: async () => (fail ? { ok: false, note: "nope", error: "transient" } : { ok: true, note: "ok" }),
    };
    const e = engine({ services: flaky, approvalWorkflowEnabled: () => false });
    let state = (await e.run(emptyExecutionState("t", plan.launchId, 0), plan, c0, { mode: "automatic" })).state;
    expect(state.campaigns[c0].status).toBe("failed");
    fail = false;
    const r = await e.retryFailed(state, plan, c0);
    expect(r.state.campaigns[c0].status).toBe("completed");
    expect(r.state.campaigns[c0].steps.find((s) => s.step === "mission")!.attempts).toBe(1); // not re-run
  });

  it("pause halts the run and resume picks it back up", async () => {
    const e = engine();
    let state = (await e.run(emptyExecutionState("t", plan.launchId, 0), plan, c0)).state;
    state = await e.pauseCampaign(state, c0);
    expect(state.campaigns[c0].status).toBe("paused");
    const r = await e.resumeCampaign(state, plan, c0);
    expect(["waiting_approval", "completed", "running"]).toContain(r.state.campaigns[c0].status);
  });

  it("emergency stop halts everything and blocks new runs until cleared", async () => {
    const e = engine();
    let state = (await e.run(emptyExecutionState("t", plan.launchId, 0), plan, c0)).state;
    state = await e.emergencyStop(state);
    expect(state.emergencyStopped).toBe(true);
    const blocked = await e.run(state, plan, c1);
    expect(blocked.ok).toBe(false);
    expect(blocked.stopped).toBe("emergency_stopped");
    state = await e.clearEmergencyStop(state);
    expect((await e.run(state, plan, c1)).ok).toBe(true);
  });

  it("queues campaigns past the concurrency limit and drains them", async () => {
    // Concurrency 1 with a gate: the first campaign parks on approval and holds the slot.
    const e = engine({ concurrency: 1 });
    let state = emptyExecutionState("t", plan.launchId, 0);
    state = (await e.run(state, plan, c0)).state;
    // Force the first campaign to look "running" so the second must queue.
    state.campaigns[c0].status = "running";
    const second = await e.run(state, plan, c1);
    expect(second.stopped).toBe("queued");
    expect(second.state.queue).toContain(c1);
  });

  it("re-arms a recurring campaign instead of looping", async () => {
    const e = engine({ approvalWorkflowEnabled: () => false });
    let state = emptyExecutionState("t", plan.launchId, 0);
    state = e.setRecurrence(state, c0, 7);
    state = (await e.run(state, plan, c0, { mode: "automatic" })).state;
    const exec = state.campaigns[c0];
    expect(exec.status).toBe("idle");
    expect(exec.mode).toBe("scheduled");
    expect(exec.startAfter).toBeGreaterThan(clock);
    expect(exec.steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("holds a scheduled campaign until its start time", async () => {
    const e = engine();
    const state = emptyExecutionState("t", plan.launchId, 0);
    const r = await e.run(state, plan, c0, { mode: "scheduled", startAfter: clock + 10_000_000 });
    expect(r.stopped).toBe("scheduled");
    expect(r.ran).toHaveLength(0);
  });

  it("records an auditable activity trail", async () => {
    const history = new InMemoryExecutionHistory();
    const e = engine({ history });
    const state = await e.run(emptyExecutionState("t", plan.launchId, 0), plan, c0);
    const feed = await history.list("t", plan.launchId, 100);
    expect(feed.length).toBeGreaterThan(5);
    expect(feed.every((x) => x.at > 0 && x.id.startsWith("act_"))).toBe(true);
    expect(feed.some((x) => x.kind === "approval_requested")).toBe(true);
    void state;
  });

  it("estimates completion only once something has actually run", () => {
    const exec = newCampaignExecution(c0, "approval", 0);
    expect(estimate(exec, 1000)).toBeNull();
    exec.steps[0] = { ...exec.steps[0], status: "completed", startedAt: 0, completedAt: 1000 };
    expect(estimate(exec, 1000)).toBeGreaterThan(1000);
  });
});

describe("campaign health", () => {
  const svc = new CampaignHealthService();
  const base: HealthInputs = {
    campaignId: c0, execution: null, itemsTotal: 10, itemsDone: 5, failedJobs: 0,
    connectedAccounts: 1, plannedChannels: 2, nextPublishDay: 5, currentDay: 3,
    engagement: null, competitorMoves: [],
  };

  it("is blocked, not merely at risk, with no connected account", () => {
    const h = svc.assess({ ...base, connectedAccounts: 0 });
    expect(h.status).toBe("blocked");
    expect(h.reasons[0].code).toBe("disconnected_account");
    expect(h.reasons[0].fix).toContain("Cross-Post");
  });

  it("explains every status with a reason and a fix", () => {
    const h = svc.assess({ ...base, failedJobs: 2, nextPublishDay: 1, currentDay: 6 });
    expect(h.reasons.length).toBeGreaterThanOrEqual(2);
    expect(h.reasons.every((r) => r.message.length > 0 && r.fix.length > 0)).toBe(true);
    expect(h.score).toBeLessThan(1);
  });

  it("does not call an unstarted campaign healthy", () => {
    const h = svc.assess({ ...base, itemsDone: 0 });
    expect(h.status).toBe("needs_attention");
    expect(h.reasons[0].code).toBe("not_started");
  });

  it("reports completion when every item is done and nothing is wrong", () => {
    expect(svc.assess({ ...base, itemsDone: 10, nextPublishDay: null }).status).toBe("completed");
  });

  it("overall health is the worst campaign, not the average", () => {
    const good = svc.assess(base);
    const bad = svc.assess({ ...base, connectedAccounts: 0 });
    expect(svc.overall([good, bad])).toBe("blocked");
  });
});

describe("notifications", () => {
  const svc = new NotificationService();
  const input = {
    tenant: "t", launchId: plan.launchId, now: 5_000, healths: [], connectedPlatforms: ["linkedin"],
    failedPublishes: 2, awaitingApprovals: 1, competitorMoves: ["Rival shipped a similar tool"],
    itemsDone: 1, itemsTotal: 10, expectedDonePercent: 0.5,
  };

  it("is deterministic — the same inputs give the same ids", () => {
    expect(svc.derive(input).map((n) => n.id)).toEqual(svc.derive(input).map((n) => n.id));
  });

  it("surfaces failures above nudges", () => {
    const list = svc.merge(svc.derive(input), {});
    expect(list[0].severity).toBe("critical");
    expect(list.some((n) => n.kind === "behind_schedule")).toBe(true);
  });

  it("a dismissal sticks across derivations", () => {
    const first = svc.derive(input);
    const dismissed = { [first[0].id]: 6_000 };
    expect(svc.merge(svc.derive(input), dismissed).some((n) => n.id === first[0].id)).toBe(false);
  });

  it("collapses duplicates — two accounts on one platform is one nudge", () => {
    const list = svc.merge(svc.derive({ ...input, connectedPlatforms: ["linkedin", "linkedin", "x"] }), {});
    const ids = list.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(list.filter((n) => n.kind === "best_time")).toHaveLength(2); // linkedin + x, not three
  });

  it("never suggests a best time for a platform it has no window model for", () => {
    const list = svc.derive({ ...input, connectedPlatforms: ["pinterest", "threads"] });
    expect(list.some((n) => n.kind === "best_time")).toBe(false);
  });

  it("every action maps to something the command bar understands", () => {
    const actions = svc.derive(input).map((n) => n.action).filter(Boolean);
    expect(actions.every((a) => ["publish now", "schedule everything", "research market"].includes(a!))).toBe(true);
  });
});

describe("adaptive timeline", () => {
  const svc = new AdaptiveTimeline();
  const market = {
    trends: [{ topic: "ai cmo", confidence: 0.8, velocity: 0.7 }],
    competitors: [{ name: "Okara", summary: "Posting daily", engagementTrend: "rising" }],
    opportunities: [{ id: "o1", title: "Own the AI CMO term", recommendedAction: "Publish a comparison", confidence: 0.7, urgency: "high" }],
  };

  it("proposes, never applies", () => {
    const proposals = svc.propose(plan, market, { currentDay: 3 });
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((p) => p.status === "proposed" && p.decidedAt === null)).toBe(true);
  });

  it("every proposal carries auditable evidence", () => {
    for (const p of svc.propose(plan, market, { currentDay: 3 })) {
      expect(p.evidence.length).toBeGreaterThan(0);
      expect(p.rationale.trim().length).toBeGreaterThan(0);
      expect(p.title.trim().length).toBeGreaterThan(0);
    }
  });

  it("stays quiet when the market is quiet", () => {
    const quiet = svc.propose(plan, { trends: [], competitors: [], opportunities: [] }, { currentDay: 0 });
    expect(quiet).toHaveLength(0);
  });

  it("records a decision without mutating the proposal it was given", () => {
    const [p] = svc.propose(plan, market, { currentDay: 3 });
    const decided = svc.decide(p, "rejected", 9_000);
    expect(p.status).toBe("proposed");
    expect(decided.status).toBe("rejected");
    expect(decided.decidedAt).toBe(9_000);
  });
});

describe("stores", () => {
  it("execution state round-trips and is scoped per tenant", async () => {
    const repo = new InMemoryExecutionStateRepo();
    const s = emptyExecutionState("a", plan.launchId, 1);
    s.campaigns[c0] = newCampaignExecution(c0, "automatic", 1);
    await repo.save(s);
    expect((await repo.get("a", plan.launchId)).campaigns[c0].mode).toBe("automatic");
    expect(Object.keys((await repo.get("b", plan.launchId)).campaigns)).toHaveLength(0);
  });

  it("dismissals persist", async () => {
    const repo = new InMemoryNotificationRepo();
    await repo.dismiss("t", plan.launchId, "ntf_1", 42);
    expect(await repo.dismissed("t", plan.launchId)).toEqual({ ntf_1: 42 });
  });
});

describe("workflow coordinator", () => {
  it("turns a thrown service error into a failed step, not a crash", async () => {
    const boom: ExecutionServices = {
      ...referenceServices(),
      research: async () => { throw new Error("network down"); },
    };
    const outcome = await new WorkflowCoordinator(boom).run("research", {
      tenant: "t", launchId: plan.launchId, campaignId: c0, plan, campaign: plan.campaigns[0], now: 1,
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("network down");
  });
});
