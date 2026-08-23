import { describe, expect, it } from "vitest";
import { AGENT_PROFILES, TEAM_ORDER, AGENT_DEPENDENCIES } from "@/lib/agents/registry";
import { AGENT_IDS } from "@/lib/agents/types";
import { readFileSync } from "node:fs";

// Nine agents existed, each with a real engine, and every one of them only ran when someone
// opened a screen and pressed something. These pin the shape of the daily sweep that makes
// them work on their own — and the two things it must not do.

const route = readFileSync("app/api/cron/agent-pass/route.ts", "utf8");
const workflow = readFileSync(".github/workflows/publish.yml", "utf8");

describe("the sweep runs the team without being asked", () => {
  it("is actually called by the schedule, not merely defined", () => {
    // A cron endpoint nothing invokes is the same as no endpoint. This project has shipped
    // that mistake before.
    expect(workflow).toContain("/api/cron/agent-pass");
  });

  it("walks the roster in the order the team hands work over", () => {
    expect(route).toContain("for (const id of TEAM_ORDER)");
  });

  it("does not touch publishing, which owns its own claim semantics", () => {
    // Two owners for one queue is how a slot gets published twice or stranded.
    expect(route).toMatch(/step === "publishing"/);
    expect(route).toMatch(/step === "platform_optimization"/);
  });

  it("plans for the customer's business or not at all", () => {
    // Falling back to DEFAULT_LAUNCH would fill someone's board with work on our company.
    expect(route).toContain("launchInputFor(profile)");
    expect(route).toContain("if (!input) continue;");
  });

  it("stops before the platform kills it, like the publish pass", () => {
    expect(route).toContain("deadline");
    expect(route).toMatch(/Date\.now\(\) > deadline/);
  });
});

describe("once a day, decided from storage rather than from the schedule", () => {
  it("checks whether this workspace is already done today", () => {
    expect(route).toContain("lastAgentPass(tenant)");
    expect(route).toMatch(/dayOf\(last\) === dayOf\(now\)/);
  });

  it("records the run after the work, never before", () => {
    // A timestamp written on entry marks the day done for a pass that then threw halfway.
    const recordAt = route.indexOf("recordAgentPass(tenant, now)");
    const runAt = route.indexOf("platform.runner.run(state, ctx, step)");
    expect(runAt).toBeGreaterThan(-1);
    expect(recordAt).toBeGreaterThan(runAt);
  });

  it("does not fail the publish job when the sweep fails", () => {
    // Publishing is what customers wait on. A red run every ten minutes for a failed sweep
    // trains everyone to ignore the tab — the mistake this workflow already made once.
    expect(workflow).toMatch(/agent team[\s\S]*?continue-on-error: true/);
  });
});

describe("the roster the sweep walks is coherent", () => {
  it("covers every agent exactly once", () => {
    expect([...TEAM_ORDER].sort()).toEqual([...AGENT_IDS].sort());
    expect(new Set(TEAM_ORDER).size).toBe(TEAM_ORDER.length);
  });

  it("never runs an agent before something it depends on", () => {
    for (const [i, id] of TEAM_ORDER.entries()) {
      for (const dep of AGENT_DEPENDENCIES[id]) {
        expect(TEAM_ORDER.indexOf(dep), `${id} runs before ${dep}`).toBeLessThan(i);
      }
    }
  });

  it("gives every agent a step to run", () => {
    for (const id of AGENT_IDS) {
      expect(AGENT_PROFILES[id].steps.length, `${id} owns no step`).toBeGreaterThan(0);
    }
  });
});
