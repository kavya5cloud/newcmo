import { describe, expect, it } from "vitest";
import { assessAutopilot, type ReadinessInput } from "@/lib/autopilot/readiness";
import { isStale, STALE_AFTER_MS } from "@/lib/autopilot/heartbeat";
import type { AssistantSettings } from "@/lib/assistant/types";
import type { Automation } from "@/lib/automation/types";

// "Why hasn't it posted" used to be three curl commands and a workflow file. These pin the
// answers, and in particular that the product never blames the user for our own gaps.

const NOW = 1_000_000_000;
const settings = (over: Partial<AssistantSettings> = {}): AssistantSettings => ({
  tenant: "t", cadence: "daily", platforms: ["linkedin"], control: "handle_routine",
  goal: "customers", paused: false, createdAt: 0, updatedAt: 0, ...over,
});
const auto = (over: Partial<Automation> = {}): Automation => ({
  id: "a1", tenant: "t", statement: "3 LinkedIn posts every week",
  platforms: ["linkedin"], cadence: { perWeek: 3, hours: [9] }, source: "ai_queue",
  release: "best_time", active: true, updatedAt: 0, ...over,
} as Automation);

const input = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  hasPlan: true, settings: settings(), automations: [auto()],
  connectedPlatforms: ["linkedin"], livePlatforms: ["linkedin"],
  heartbeat: { at: NOW - 60_000, dispatched: 0, tenants: 1 }, now: NOW, ...over,
});

describe("a fully wired workspace is reported as autonomous", () => {
  it("has nothing to report and says what is done", () => {
    const r = assessAutopilot(input());
    expect(r.autonomous).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.done).toContain("Publisher running");
    expect(r.done.join(" ")).toContain("LinkedIn");
  });
});

describe("each gap names its own next action", () => {
  it("does not list six problems for one missing setup", () => {
    const r = assessAutopilot(input({ settings: null }));
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0].code).toBe("not_configured");
  });

  it("blames our missing credentials on us, not on the user", () => {
    const r = assessAutopilot(input({ livePlatforms: [], connectedPlatforms: [] }));
    const b = r.blockers.find((x) => x.code === "no_live_platform")!;
    // No "connect an account" link here: it would send someone to a button that cannot work.
    expect(b.fix).toBeNull();
    expect(b.detail).toMatch(/Populr's own app credentials/);
  });

  it("asks for consent only when consent is the missing part", () => {
    const r = assessAutopilot(input({ connectedPlatforms: [] }));
    const b = r.blockers.find((x) => x.code === "no_account")!;
    expect(b.fix?.href).toBe("/studio/integrations");
    expect(b.detail).toContain("LinkedIn");
  });

  it("treats holding for approval as a choice, not a fault", () => {
    const r = assessAutopilot(input({ automations: [auto({ release: "after_approval" })] }));
    const b = r.blockers.find((x) => x.code === "holds_for_approval")!;
    expect(b.blocking).toBe(false);
    expect(b.detail).toMatch(/setting, not a fault/);
    // It still means Populr will not post unattended, which is the question being asked.
    expect(r.autonomous).toBe(false);
  });

  it("distinguishes a stalled publisher from one that never ran", () => {
    const never = assessAutopilot(input({ heartbeat: null }));
    expect(never.blockers.find((b) => b.code === "publisher_stalled")!.title).toMatch(/never run/);
    const stalled = assessAutopilot(input({ heartbeat: { at: NOW - STALE_AFTER_MS - 1, dispatched: 0, tenants: 1 } }));
    expect(stalled.blockers.find((b) => b.code === "publisher_stalled")!.title).toMatch(/gone quiet/);
  });

  it("says a lapsed plan stops publishing, because it does", () => {
    const r = assessAutopilot(input({ hasPlan: false }));
    const b = r.blockers.find((x) => x.code === "no_plan")!;
    expect(b.blocking).toBe(true);
    expect(r.autonomous).toBe(false);
  });
});

describe("the publisher is given two missed runs before anyone is told", () => {
  it("tolerates one late run, because scheduled jobs are routinely delayed", () => {
    expect(isStale({ at: NOW - 15 * 60_000, dispatched: 0, tenants: 0 }, NOW)).toBe(false);
    expect(isStale({ at: NOW - 31 * 60_000, dispatched: 0, tenants: 0 }, NOW)).toBe(true);
  });

  it("treats never having run as stale", () => {
    expect(isStale(null, NOW)).toBe(true);
  });
});
