import { describe, it, expect } from "vitest";
import { planVisuals } from "@/lib/creative-intelligence/visual-planner";
import type { CreativeBriefInput } from "@/lib/creative/types";

const brief: CreativeBriefInput = {
  objective: "Launch", audience: "founders", keyMessage: "AI CMO", emotionalAngle: "clean minimal",
  proof: "engine", cta: "join", visualDirection: "clean minimal", successMetric: "signups",
};

describe("Visual Planner", () => {
  it("produces a full, non-empty visual plan", () => {
    const v = planVisuals(brief, "hero_video", "confidence");
    expect(v.composition).toBeTruthy();
    expect(v.colorPalette.length).toBeGreaterThan(0);
    expect(v.lighting).toBeTruthy();
    expect(v.typography).toBeTruthy();
    expect(v.mood).toBeTruthy();
  });

  it("anchors the palette on the brand accent and varies by emotion", () => {
    expect(planVisuals(brief, "hero_video", "confidence").colorPalette[0]).toBe("#d5ff72");
    const urgency = planVisuals(brief, "hero_video", "urgency").colorPalette;
    const calm = planVisuals(brief, "hero_video", "confidence").colorPalette;
    expect(urgency).not.toEqual(calm);
  });

  it("sets motion style for video kinds and static for stills", () => {
    expect(planVisuals(brief, "hero_video", "confidence").motionStyle).not.toBe("none (static)");
    expect(planVisuals(brief, "carousel", "confidence").motionStyle).toBe("none (static)");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(planVisuals(brief, "hero_video", "confidence")))
      .toBe(JSON.stringify(planVisuals(brief, "hero_video", "confidence")));
  });
});
