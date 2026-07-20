import { describe, it, expect } from "vitest";
import { createLaunch } from "@/lib/launch/engine";
import type { LaunchInput } from "@/lib/launch/types";
import { buildCalendar, calendarView, reschedule, duplicate, cancel } from "@/lib/publishing/calendar";
import { packageFromLaunchPlan, packageDownstream } from "@/lib/publishing/packages";
import { ApprovalWorkflow } from "@/lib/publishing/approvals";
import { runExperiment, createExperiment } from "@/lib/publishing";

const INPUT: LaunchInput = {
  launchType: "ai_tool_launch",
  mission: "Launch Populr",
  business: { name: "Populr", audience: "founders", oneLiner: "an AI CMO" },
  timelineDays: 28,
};
const plan = createLaunch(INPUT);

describe("Marketing Calendar", () => {
  it("builds calendar events from the launch schedule with resolved platforms", () => {
    const events = buildCalendar(plan);
    expect(events.length).toBe(plan.publishingSchedule.length);
    expect(events.every((e) => e.platform && e.campaignId)).toBe(true);
  });

  it("groups into week, campaign and platform views deterministically", () => {
    const events = buildCalendar(plan);
    expect(calendarView(events, "week").length).toBeGreaterThan(0);
    expect(calendarView(events, "platform").length).toBeGreaterThan(0);
    expect(JSON.stringify(calendarView(events, "week"))).toBe(JSON.stringify(calendarView(events, "week")));
  });

  it("supports reschedule / duplicate / cancel as pure transforms", () => {
    const events = buildCalendar(plan);
    const key = events[0].assetKey;
    expect(reschedule(events, key, 14).find((e) => e.assetKey === key)!.dayOffset).toBe(14);
    expect(duplicate(events, key).length).toBe(events.length + 1);
    expect(cancel(events, key).some((e) => e.assetKey === key)).toBe(false);
  });
});

describe("Content Packages", () => {
  it("turns a Launch Engine plan into a package with lineage", () => {
    const pkg = packageFromLaunchPlan(plan);
    expect(pkg.launchId).toBe(plan.launchId);
    expect(pkg.assets.length).toBeGreaterThan(0);
    expect(pkg.lineage.length).toBe(plan.dependencies.edges.length);
    // every asset carries a resolved platform and campaign
    expect(pkg.assets.every((a) => a.platform && a.campaignId)).toBe(true);
  });

  it("exposes downstream lineage for an asset", () => {
    const pkg = packageFromLaunchPlan(plan);
    const root = pkg.assets.find((a) => a.dependsOn.length === 0)!;
    expect(Array.isArray(packageDownstream(pkg, root.assetKey))).toBe(true);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(packageFromLaunchPlan(plan))).toBe(JSON.stringify(packageFromLaunchPlan(plan)));
  });
});

describe("Approval Workflow", () => {
  it("records individual and bulk approvals with role/user/version", () => {
    const w = new ApprovalWorkflow();
    const rec = w.approve("a", "creative_director", "sam", "looks great", 2);
    expect(rec.role).toBe("creative_director");
    expect(rec.version).toBe(2);
    w.bulkApprove(["b", "c"], "marketing_lead", "lee");
    expect(w.all().length).toBe(3);
  });

  it("role-based gate requires all roles to approve", () => {
    const w = new ApprovalWorkflow();
    w.approve("a", "creative_director", "sam");
    expect(w.isApproved("a")).toBe(false); // still needs marketing_lead + founder
    w.approve("a", "marketing_lead", "lee");
    w.approve("a", "founder", "ceo");
    expect(w.isApproved("a")).toBe(true);
    expect(w.pendingFor(["a", "b"], "founder")).toEqual(["b"]);
  });
});

describe("Experiment Engine (reused, publishing context)", () => {
  it("decides a winner from recorded metrics", () => {
    const exp = createExperiment({ id: "e1", type: "ab_headline", hypothesis: "A beats B", variants: [{ id: "A", label: "A" }, { id: "B", label: "B" }], assetKey: "c1:linkedin_post" });
    const decided = runExperiment(exp, [{ variantId: "A", metric: 80 }, { variantId: "B", metric: 20 }]);
    expect(decided.winnerVariantId).toBe("A");
    expect(decided.confidence).toBeGreaterThan(0);
  });
});
