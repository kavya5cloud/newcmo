import { describe, it, expect } from "vitest";
import { createLaunch } from "@/lib/launch/engine";
import { DEFAULT_LAUNCH } from "@/lib/launch/shared";
import {
  AUTOMATION_KEYS, applyItemAction, applyMissionEdit, campaignProgress, defaultAutomation,
  effectiveMission, emptyState, isItemAction, setAutomation, statusOf, workspaceSummary,
} from "@/lib/launch/workspace";
import { InMemoryWorkspaceStateRepo } from "@/lib/launch/workspace-store";
import { parseCommand } from "@/lib/launch/command";

// Launch Workspace execution state + command bar. The plan stays the Launch Engine's; these
// tests pin the overlay that makes it actionable, and the deterministic command parsing that
// drives real side effects.

const plan = createLaunch(DEFAULT_LAUNCH);
const anyItem = plan.weeks.flatMap((w) => w.items)[0];

describe("workspace state", () => {
  it("starts empty with every item to-do", () => {
    const s = emptyState("ws", plan.launchId);
    expect(statusOf(s, anyItem.assetKey)).toBe("todo");
    expect(workspaceSummary(plan, s).done).toBe(0);
  });

  it("never mutates the state it is given", () => {
    const s = emptyState("ws", plan.launchId);
    const next = applyItemAction(s, anyItem.assetKey, "complete");
    expect(statusOf(s, anyItem.assetKey)).toBe("todo");
    expect(statusOf(next, anyItem.assetKey)).toBe("done");
  });

  it("reset removes the override rather than inventing a status", () => {
    let s = applyItemAction(emptyState("ws", plan.launchId), anyItem.assetKey, "pause");
    expect(statusOf(s, anyItem.assetKey)).toBe("paused");
    s = applyItemAction(s, anyItem.assetKey, "reset");
    expect(Object.keys(s.items)).toHaveLength(0);
  });

  it("completing every item of a campaign marks it complete", () => {
    const c = plan.campaigns[0];
    const keys = plan.weeks.flatMap((w) => w.items.filter((i) => i.campaignId === c.id).map((i) => i.assetKey));
    let s = emptyState("ws", plan.launchId);
    for (const k of keys) s = applyItemAction(s, k, "complete");
    const p = campaignProgress(plan, s).find((x) => x.campaignId === c.id)!;
    expect(p.done).toBe(p.total);
    expect(p.percent).toBe(1);
    expect(p.status).toBe("complete");
  });

  it("reports the next unpublished slot, and nothing once it is done", () => {
    const c = plan.campaigns[0];
    const before = campaignProgress(plan, emptyState("ws", plan.launchId)).find((x) => x.campaignId === c.id)!;
    expect(before.nextPublish).not.toBeNull();

    let s = emptyState("ws", plan.launchId);
    for (const slot of plan.publishingSchedule) s = applyItemAction(s, slot.assetKey, "complete");
    const after = campaignProgress(plan, s).find((x) => x.campaignId === c.id)!;
    expect(after.nextPublish).toBeNull();
  });

  it("summary aggregates across campaigns", () => {
    let s = emptyState("ws", plan.launchId);
    const keys = plan.weeks.flatMap((w) => w.items.map((i) => i.assetKey));
    s = applyItemAction(s, keys[0], "complete");
    s = applyItemAction(s, keys[1], "start");
    s = applyItemAction(s, keys[2], "pause");
    const sum = workspaceSummary(plan, s);
    expect(sum.done).toBe(1);
    expect(sum.inProgress).toBe(1);
    expect(sum.paused).toBe(1);
    expect(sum.totalItems).toBeGreaterThan(3);
  });

  it("automation toggles independently and defaults to a safe posture", () => {
    const d = defaultAutomation();
    expect(d.approvalWorkflow).toBe(true);       // nothing goes live unreviewed by default
    expect(d.campaignExecution).toBe(false);     // Populr does not run the launch unasked
    let s = emptyState("ws", plan.launchId);
    s = setAutomation(s, "campaignExecution", true);
    expect(s.automation.campaignExecution).toBe(true);
    expect(s.automation.approvalWorkflow).toBe(true);
    expect(AUTOMATION_KEYS.every((k) => typeof s.automation[k] === "boolean")).toBe(true);
  });

  it("mission edits layer over the plan without changing it", () => {
    const s = applyMissionEdit(emptyState("ws", plan.launchId), { mission: "Launch the beta" });
    const eff = effectiveMission(plan, s);
    expect(eff.mission).toBe("Launch the beta");
    expect(eff.kpis).toEqual(plan.kpis);          // untouched fields fall through
    expect(plan.mission).toBe(DEFAULT_LAUNCH.mission);
  });

  it("rejects actions it does not know", () => {
    expect(isItemAction("complete")).toBe(true);
    expect(isItemAction("delete")).toBe(false);
  });
});

describe("workspace store", () => {
  it("round-trips and returns an empty state for unknown launches", async () => {
    const repo = new InMemoryWorkspaceStateRepo();
    expect((await repo.get("ws", "nope")).items).toEqual({});
    const s = applyItemAction(emptyState("ws", plan.launchId), anyItem.assetKey, "complete");
    await repo.save(s);
    expect(statusOf(await repo.get("ws", plan.launchId), anyItem.assetKey)).toBe("done");
  });

  it("scopes state by workspace", async () => {
    const repo = new InMemoryWorkspaceStateRepo();
    await repo.save(applyItemAction(emptyState("a", plan.launchId), anyItem.assetKey, "complete"));
    expect((await repo.get("b", plan.launchId)).items).toEqual({});
  });
});

describe("command bar", () => {
  it("parses the four documented examples", () => {
    expect(parseCommand("Launch my product next week")).toMatchObject({ intent: "launch_product", params: { timelineDays: 7 } });
    expect(parseCommand("Create a campaign for the beta waitlist").intent).toBe("create_campaign");
    expect(parseCommand("Generate 10 LinkedIn posts")).toMatchObject({ intent: "generate_assets", params: { quantity: 10, platform: "linkedin" } });
    expect(parseCommand("Schedule everything").intent).toBe("schedule_all");
  });

  it("reads horizons in days, weeks and shorthand", () => {
    expect(parseCommand("launch in 3 weeks").params.timelineDays).toBe(21);
    expect(parseCommand("launch in 10 days").params.timelineDays).toBe(10);
    expect(parseCommand("launch tomorrow").params.timelineDays).toBe(1);
    expect(parseCommand("launch").params.timelineDays).toBe(28);   // template default
  });

  it("maps platform words to provider ids", () => {
    expect(parseCommand("generate 3 IG posts").params.platform).toBe("instagram_business");
    expect(parseCommand("write 2 twitter posts").params.platform).toBe("x");
    expect(parseCommand("draft 4 facebook posts").params.platform).toBe("facebook_pages");
  });

  it("is deterministic", () => {
    expect(parseCommand("Schedule everything")).toEqual(parseCommand("schedule EVERYTHING"));
  });

  it("says so instead of guessing when it cannot parse", () => {
    const p = parseCommand("make me a sandwich");
    expect(p.intent).toBe("unknown");
    expect(p.summary).toContain("Schedule everything");
  });

  it("does not mistake a campaign request for a launch", () => {
    expect(parseCommand("create a campaign to launch the beta").intent).toBe("create_campaign");
  });
});
