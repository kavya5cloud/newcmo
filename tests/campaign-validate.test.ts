import { describe, it, expect } from "vitest";
import { validateCampaignInput } from "../lib/services/campaign-validate";

const goodBrief = {
  objective: "Get 500 founders to see the launch",
  audience: "Early-stage founders doing their own marketing",
  keyMessage: "An AI CMO that says no to busywork",
  emotionalAngle: "Relief — someone finally prioritizes for you",
  proof: "Built-in outcome tracking shows what worked",
  cta: "Try free for a month",
  visualDirection: "Dark, mono, terminal aesthetic",
  successMetric: "Signups from launch-week traffic",
};

const good = {
  goal: "launch_product",
  title: "Product Hunt launch week",
  brief: goodBrief,
  channels: ["linkedin", "reddit", "x"],
  timelineDays: 14,
  priority: 1,
  expectedImpact: "High — launch spikes compound with Reddit follow-up",
  reasoning: "Reddit ranks highest in the decision engine for this business; LinkedIn reaches the founder audience directly.",
  tasks: [
    { week: 1, channel: "linkedin", title: "Publish founder teaser post", intent: "warm up audience" },
    { week: 1, channel: "x", title: "Thread on why we built this", intent: "build anticipation" },
    { week: 2, channel: "reddit", title: "Post launch case study with real numbers", intent: "high-intent traffic" },
  ],
};

describe("validateCampaignInput", () => {
  it("accepts a complete campaign", () => {
    const r = validateCampaignInput(good);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.tasks).toHaveLength(3);
      expect(r.value.channels).toEqual(["linkedin", "reddit", "x"]);
    }
  });

  it("rejects a missing brief field", () => {
    const r = validateCampaignInput({ ...good, brief: { ...goodBrief, proof: "" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("brief.proof");
  });

  it("rejects unknown channels and empty channel lists", () => {
    const r = validateCampaignInput({ ...good, channels: ["tiktok", "myspace"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("channels");
  });

  it("filters invalid tasks and rejects when too few remain", () => {
    const r = validateCampaignInput({
      ...good,
      tasks: [{ week: 1, channel: "nope", title: "bad" }, ...good.tasks.slice(0, 1)],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("tasks");
  });

  it("clamps task weeks into range and rejects out-of-range timelines", () => {
    const okWeeks = validateCampaignInput({
      ...good,
      tasks: good.tasks.map((t) => ({ ...t, week: 99 })),
    });
    expect(okWeeks.ok).toBe(true);
    if (okWeeks.ok) expect(okWeeks.value.tasks.every((t) => t.week === 13)).toBe(true);

    expect(validateCampaignInput({ ...good, timelineDays: 3 }).ok).toBe(false);
    expect(validateCampaignInput({ ...good, timelineDays: 400 }).ok).toBe(false);
  });

  it("rejects thin reasoning (the decision-first receipt is mandatory)", () => {
    const r = validateCampaignInput({ ...good, reasoning: "because" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("reasoning");
  });

  it("dedupes channels and normalizes case", () => {
    const r = validateCampaignInput({ ...good, channels: ["LinkedIn", "linkedin", "REDDIT"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.channels).toEqual(["linkedin", "reddit"]);
  });
});
