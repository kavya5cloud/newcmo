import { describe, it, expect } from "vitest";
import { buildScript } from "@/lib/creative-intelligence/script-engine";
import type { CreativeBriefInput } from "@/lib/creative/types";

const brief: CreativeBriefInput = {
  objective: "Launch", audience: "founders", keyMessage: "an AI CMO that reasons", emotionalAngle: "calm confidence",
  proof: "deterministic engine", cta: "join early access", visualDirection: "clean", successMetric: "signups",
};

describe("Script Engine", () => {
  it("produces the five typed sections in order", () => {
    const s = buildScript(brief, "hero_video");
    expect(s.sections.map((x) => x.label)).toEqual(["hook", "opening", "middle", "cta", "closing"]);
  });

  it("each section has non-negative timing and the sequence is contiguous", () => {
    const s = buildScript(brief, "hero_video");
    let t = 0;
    for (const sec of s.sections) {
      expect(sec.startSec).toBe(t);
      expect(sec.durationSec).toBeGreaterThan(0);
      t += sec.durationSec;
    }
    expect(s.totalDurationSec).toBe(t);
  });

  it("carries captions, voice notes and the CTA", () => {
    const s = buildScript(brief, "hero_video");
    expect(s.captions.length).toBeGreaterThan(0);
    expect(s.voiceNotes.length).toBeGreaterThan(0);
    expect(s.sections.find((x) => x.label === "cta")!.text).toBe("join early access");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildScript(brief, "hero_video"))).toBe(JSON.stringify(buildScript(brief, "hero_video")));
  });
});
