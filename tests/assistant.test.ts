import { describe, expect, it } from "vitest";
import {
  CADENCE_META, CADENCES, CONTROL_META, CONTROL_LEVELS, GOAL_META, GOALS,
  PLATFORM_CHOICES, READY_PLATFORMS,
} from "@/lib/assistant/types";
import {
  defaultSetup, describePlan, earlyAccessAmong, planFor, releaseFor, sourceForGoal, statementFor,
} from "@/lib/assistant/plan";
import { buildStatus, describeWhen, headline } from "@/lib/assistant/status";
import { parseAutomations } from "@/lib/automation/parse";
import type { QueueItem } from "@/lib/automation/types";
import type { AssistantSetup } from "@/lib/assistant/types";

const setup = (over: Partial<AssistantSetup> = {}): AssistantSetup => ({
  cadence: "few_weekly", platforms: ["linkedin"], control: "review_all", goal: "customers", ...over,
});

// The vocabulary rule is a product promise, not a style preference: a business owner should
// never have to learn what a queue or a pipeline is to use this. Asserting it keeps the
// promise from eroding one label at a time.
const FORBIDDEN = [
  "automation", "workflow", "pipeline", "queue", "scheduler", "trigger",
  "rule", "job engine", "confidence",
];

describe("the words a user reads", () => {
  const surfaces = [
    ...CADENCES.flatMap((c) => [CADENCE_META[c].label, CADENCE_META[c].detail]),
    ...CONTROL_LEVELS.flatMap((c) => [CONTROL_META[c].label, CONTROL_META[c].detail]),
    ...GOALS.flatMap((g) => [GOAL_META[g].label, GOAL_META[g].detail]),
    ...PLATFORM_CHOICES.flatMap((p) => [p.label, p.expectation]),
  ];

  it("never exposes internal machinery", () => {
    for (const text of surfaces) {
      for (const word of FORBIDDEN) {
        expect(text.toLowerCase(), `"${text}" leaks "${word}"`).not.toContain(word);
      }
    }
  });

  it("asks four questions and no more", () => {
    expect(CADENCES).toHaveLength(3);
    expect(CONTROL_LEVELS).toHaveLength(3);
    expect(GOALS).toHaveLength(5);
    // Four answers total. Anything beyond these is inferred, not asked.
    expect(Object.keys(setup()).sort()).toEqual(["cadence", "control", "goal", "platforms"]);
  });
});

describe("platform readiness", () => {
  it("offers every platform rather than hiding the unfinished ones", () => {
    // Hiding Instagram teaches "Populr doesn't do Instagram", which outlives the gap.
    const names = PLATFORM_CHOICES.map((p) => p.platform);
    expect(names).toEqual(expect.arrayContaining([
      "linkedin", "x", "instagram_business", "facebook_pages", "threads", "pinterest",
    ]));
    expect(names).toHaveLength(6);
  });

  it("marks only what can actually publish as ready", () => {
    expect(READY_PLATFORMS).toEqual(["linkedin", "x"]);
  });

  it("tells the truth about what an early-access choice does", () => {
    for (const p of PLATFORM_CHOICES.filter((c) => c.readiness === "early_access")) {
      // It must promise writing, and must not imply publishing already works.
      expect(p.expectation).toMatch(/writes/i);
      expect(p.expectation).toMatch(/coming|early access/i);
    }
    for (const p of PLATFORM_CHOICES.filter((c) => c.readiness === "ready")) {
      expect(p.expectation).toMatch(/publishes/i);
    }
  });

  it("reports which chosen platforms cannot publish yet", () => {
    expect(earlyAccessAmong(["linkedin", "instagram_business", "x", "threads"]))
      .toEqual(["instagram_business", "threads"]);
    expect(earlyAccessAmong(["linkedin", "x"])).toEqual([]);
  });
});

describe("turning answers into a plan", () => {
  it("produces a sentence the existing engine can already parse", () => {
    // The whole design rests on this: no new engine, just a sentence it understands.
    for (const cadence of CADENCES) {
      for (const p of PLATFORM_CHOICES) {
        const statement = statementFor(setup({ cadence }), p.platform);
        const parsed = parseAutomations(statement);
        expect(parsed.any, `"${statement}" did not parse`).toBe(true);
        expect(parsed.clauses[0].ok && parsed.clauses[0].platform).toBe(p.platform);
      }
    }
  });

  it("keeps the sentence readable, because it is what gets shown if anyone asks why", () => {
    expect(statementFor(setup({ cadence: "few_weekly" }), "linkedin")).toBe("3 LinkedIn posts every week");
    expect(statementFor(setup({ cadence: "weekly" }), "x")).toBe("1 X post every week");
    expect(statementFor(setup({ cadence: "daily" }), "instagram_business")).toBe("1 Instagram post every day");
  });

  it("holds everything for approval when the user wants to see everything", () => {
    for (const goal of GOALS) {
      expect(releaseFor("review_all", sourceForGoal(goal))).toBe("after_approval");
    }
  });

  it("holds only launch content when the user wants the important ones", () => {
    // "Important" has to mean something defensible. Launch content has a date and the most
    // to lose; routine posts do not. Guessing beyond that would be a coin flip.
    expect(releaseFor("review_important", "campaigns")).toBe("after_approval");
    expect(releaseFor("review_important", "ai_queue")).toBe("best_time");
  });

  it("publishes without waiting when the user hands over routine marketing", () => {
    expect(releaseFor("handle_routine", "ai_queue")).toBe("best_time");
    expect(releaseFor("handle_routine", "campaigns")).toBe("best_time");
  });

  it("plans for early-access platforms too, so the content exists when publishing opens", () => {
    const plan = planFor(setup({ platforms: ["linkedin", "instagram_business"] }));
    expect(plan).toHaveLength(2);
    expect(plan.find((p) => p.platform === "linkedin")!.canPublish).toBe(true);
    expect(plan.find((p) => p.platform === "instagram_business")!.canPublish).toBe(false);
  });

  it("sends a launch through campaigns and everything else through fresh writing", () => {
    expect(sourceForGoal("launch")).toBe("campaigns");
    for (const g of GOALS.filter((x) => x !== "launch")) expect(sourceForGoal(g)).toBe("ai_queue");
  });

  it("starts cautious when it has to guess", () => {
    // Trust is earned. Defaulting a stranger's account to auto-publish is not a good guess.
    expect(defaultSetup().control).toBe("review_all");
  });

  it("infers the platforms from what is already connected rather than asking again", () => {
    expect(defaultSetup(["x"]).platforms).toEqual(["x"]);
    // An early-access connection cannot publish, so it is not assumed as the answer.
    expect(defaultSetup(["threads"]).platforms).toEqual(["linkedin"]);
  });

  it("describes the plan in a line a person would say out loud", () => {
    expect(describePlan(setup())).toBe("LinkedIn, 3× a week.");
    expect(describePlan(setup({ platforms: ["linkedin", "x"], cadence: "daily" }))).toBe("2 platforms, every day.");
  });
});

describe("the status screen", () => {
  const item = (over: Partial<QueueItem>): QueueItem => ({
    id: "q1", tenant: "t", automationId: "a1", platform: "linkedin", source: "ai_queue",
    at: 0, state: "upcoming", jobId: null, order: 0, note: null, ...over,
  });
  const now = Date.UTC(2026, 0, 5, 12, 0);
  const day = 86_400_000;

  it("counts only what is still going to happen", () => {
    const s = buildStatus([
      item({ id: "1", at: now + day }),
      item({ id: "2", at: now + 2 * day, state: "waiting_approval" }),
      item({ id: "3", at: now - day, state: "published" }),   // history, not a plan
      item({ id: "4", at: now + 3 * day, state: "cancelled" }),
    ], { configured: true, paused: false, platforms: ["linkedin"], now });

    expect(s.plannedThisWeek).toBe(2);
    expect(s.awaitingApproval).toBe(1);
  });

  it("does not count next week's posts as this week's", () => {
    const s = buildStatus([item({ id: "1", at: now + day }), item({ id: "2", at: now + 9 * day })],
      { configured: true, paused: false, platforms: [], now });
    expect(s.plannedThisWeek).toBe(1);
  });

  it("counts an approval waiting beyond this week, because it is still waiting on you", () => {
    const s = buildStatus([item({ id: "1", at: now + 10 * day, state: "waiting_approval" })],
      { configured: true, paused: false, platforms: [], now });
    expect(s.plannedThisWeek).toBe(0);
    expect(s.awaitingApproval).toBe(1);
  });

  it("points at the soonest post regardless of the order it was stored in", () => {
    const s = buildStatus([item({ id: "late", at: now + 5 * day }), item({ id: "soon", at: now + day, platform: "x" })],
      { configured: true, paused: false, platforms: [], now });
    expect(s.nextPublishAt).toBe(now + day);
    expect(s.nextPublishPlatform).toBe("x");
  });

  it("says nothing is scheduled rather than showing a stale date", () => {
    const s = buildStatus([], { configured: true, paused: false, platforms: [], now });
    expect(s.nextPublishAt).toBeNull();
  });

  it("reads the state in plain words", () => {
    const base = { plannedThisWeek: 0, nextPublishAt: null, nextPublishPlatform: null, awaitingApproval: 0, earlyAccessPlatforms: [] };
    expect(headline({ ...base, configured: false, paused: false })).toBe("Not set up yet");
    expect(headline({ ...base, configured: true, paused: true })).toBe("Paused");
    expect(headline({ ...base, configured: true, paused: false })).toBe("Working");
  });
});

describe("when a post goes out, in words", () => {
  const now = Date.UTC(2026, 0, 5, 12, 0);
  it("says today and tomorrow rather than a date", () => {
    expect(describeWhen(now + 3 * 3_600_000, now, "UTC")).toMatch(/^Today /);
    expect(describeWhen(now + 22 * 3_600_000, now, "UTC")).toMatch(/^Tomorrow /);
  });

  it("uses the weekday inside a week, and a date beyond it", () => {
    expect(describeWhen(now + 3 * 86_400_000, now, "UTC")).toMatch(/^Thursday /);
    expect(describeWhen(now + 20 * 86_400_000, now, "UTC")).toMatch(/^Jan 25/);
  });
});

describe("the home hero's suggestions", () => {
  // A chip that leads nowhere is worse than no chip. These assert each suggested phrase
  // classifies as something the hero has a real destination for.
  const SUGGESTIONS = [
    "Launch my product next week",
    "Grow my LinkedIn",
    "Announce version 2",
    "Bring more traffic",
  ];

  it("routes every suggestion to a real destination", async () => {
    const { routeIntent } = await import("@/lib/services/intent-router");
    // The hero handles all six intents: campaign/strategy → plans, analysis → results,
    // content/edit/transform → create. So any classification is handled — what matters is
    // that routing is deterministic and never throws on these phrases.
    for (const s of SUGGESTIONS) {
      const routed = routeIntent(s);
      expect(["campaign", "strategy", "analysis", "content", "edit", "transform"]).toContain(routed.intent);
    }
  });

  it("sends a launch to the plan, not to a report", async () => {
    const { routeIntent } = await import("@/lib/services/intent-router");
    expect(routeIntent("Launch my product next week").intent).toBe("campaign");
  });

  it("recognises a platform ask as something to write", async () => {
    const { routeIntent } = await import("@/lib/services/intent-router");
    const r = routeIntent("Grow my LinkedIn");
    expect(r.intent).toBe("content");
    expect(r.asset).toBe("linkedin_post");
  });
});

describe("page titles", () => {
  // Regression: the root layout appends the brand via a title template, so a page that also
  // writes it renders "Create — Populr — Populr". This has now happened twice.
  it("never repeat the brand, because the template already adds it", async () => {
    const mods = await Promise.all([
      import("@/app/studio/layout"),
      import("@/app/privacy/page"),
      import("@/app/terms/page"),
      import("@/app/early-access/layout"),
      import("@/app/worked/layout"),
    ]);
    for (const m of mods) {
      const t = m.metadata?.title;
      if (typeof t === "string") expect(t).not.toMatch(/Populr/);
    }
  });
});
