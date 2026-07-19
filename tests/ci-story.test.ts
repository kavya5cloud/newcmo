import { describe, it, expect } from "vitest";
import { buildStory, storyFormatForKind } from "@/lib/creative-intelligence/story-engine";
import type { CreativeBriefInput } from "@/lib/creative/types";

const brief: CreativeBriefInput = {
  objective: "Launch the product", audience: "founders", keyMessage: "an AI CMO that reasons",
  emotionalAngle: "calm confidence", proof: "deterministic engine", cta: "join early access",
  visualDirection: "clean minimal", successMetric: "signups",
};

describe("Story Engine", () => {
  it("maps kinds to formats", () => {
    expect(storyFormatForKind("hero_video")).toBe("launch_video");
    expect(storyFormatForKind("ugc_video")).toBe("ugc");
    expect(storyFormatForKind("advertisement")).toBe("ad");
  });

  it("builds acts → scenes → shots with all beat fields", () => {
    const story = buildStory(brief, "hero_video");
    expect(story.acts.length).toBeGreaterThan(0);
    const scenes = story.acts.flatMap((a) => a.scenes);
    expect(scenes.length).toBeGreaterThan(0);
    for (const s of scenes) {
      expect(s.purpose).toBeTruthy();
      expect(s.emotion).toBeTruthy();
      expect(s.durationSec).toBeGreaterThan(0);
      expect(s.camera).toBeTruthy();
      expect(s.visualObjective).toBeTruthy();
      expect(s.transition).toBeTruthy();
      expect(s.shots.length).toBe(2);
      expect(s.visualNotes).toBeTruthy();
      expect(s.motionNotes).toBeTruthy();
    }
  });

  it("totalDuration equals the sum of scene durations", () => {
    const story = buildStory(brief, "hero_video");
    const sum = story.acts.flatMap((a) => a.scenes).reduce((n, s) => n + s.durationSec, 0);
    expect(story.totalDurationSec).toBe(sum);
  });

  it("carries the CTA and a logline referencing the audience", () => {
    const story = buildStory(brief, "hero_video");
    expect(story.cta).toBe("join early access");
    expect(story.logline.toLowerCase()).toContain("founders");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildStory(brief, "hero_video"))).toBe(JSON.stringify(buildStory(brief, "hero_video")));
  });
});
