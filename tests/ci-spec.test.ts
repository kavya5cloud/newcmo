import { describe, it, expect } from "vitest";
import { buildSpecification, modalityForKind, resolveEmotion } from "@/lib/creative-intelligence/spec-builder";
import { toProviderSpec } from "@/lib/creative-intelligence/contract";
import type { CreativeBriefInput } from "@/lib/creative/types";

const brief: CreativeBriefInput = {
  objective: "Launch the product", audience: "founders", keyMessage: "an AI CMO that reasons",
  emotionalAngle: "calm confidence", proof: "deterministic engine", cta: "join early access",
  visualDirection: "clean minimal", successMetric: "signups",
};

describe("Generation Specification", () => {
  it("maps kinds to modalities", () => {
    expect(modalityForKind("hero_video")).toBe("video");
    expect(modalityForKind("motion_graphic")).toBe("motion");
    expect(modalityForKind("carousel")).toBe("image");
    expect(modalityForKind("blog")).toBe("document");
  });

  it("resolves emotion from the brief", () => {
    expect(resolveEmotion({ ...brief, emotionalAngle: "urgent now" })).toBe("urgency");
    expect(resolveEmotion({ ...brief, emotionalAngle: "calm confidence" })).toBe("confidence");
  });

  it("builds a complete spec for a video kind (story + script + hook + visual)", () => {
    const spec = buildSpecification({ assetType: "hero_video", brief, campaignId: "c1", missionId: "m1" });
    expect(spec.assetType).toBe("hero_video");
    expect(spec.campaignId).toBe("c1");
    expect(spec.storyStructure).not.toBeNull();
    expect(spec.script).not.toBeNull();
    expect(spec.hook).not.toBeNull();
    expect(spec.visualDirection.colorPalette.length).toBeGreaterThan(0);
    expect(spec.brandRules.bannedClaims.length).toBeGreaterThan(0);
    expect(spec.approvalRequirements.requiresCouncil).toBe(true);
  });

  it("builds a document spec without a story", () => {
    const spec = buildSpecification({ assetType: "blog", brief });
    expect(spec.providerRequirements.modality).toBe("document");
    expect(spec.storyStructure).toBeNull();
  });

  it("normalizes into the right provider spec (never a raw prompt as interface)", () => {
    const spec = buildSpecification({ assetType: "hero_video", brief });
    const ps = toProviderSpec(spec);
    expect(ps.modality).toBe("video");
    expect(ps.kind).toBe("hero_video");
    // the prompt is a derived rendering, present but not the source of truth
    expect(typeof ps.prompt).toBe("string");
    expect(ps.prompt.length).toBeGreaterThan(0);
    if (ps.modality === "video") {
      expect(ps.scenes && ps.scenes.length).toBeGreaterThan(0);
      expect(ps.durationSec).toBeGreaterThan(0);
    }

    const doc = toProviderSpec(buildSpecification({ assetType: "blog", brief }));
    expect(doc.modality).toBe("document");
    if (doc.modality === "document") expect(doc.sections && doc.sections.length).toBeGreaterThan(0);
  });

  it("is deterministic end-to-end (same brief → identical spec)", () => {
    const a = buildSpecification({ assetType: "hero_video", brief, campaignId: "c1" });
    const b = buildSpecification({ assetType: "hero_video", brief, campaignId: "c1" });
    expect(a.id).toBe(b.id);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
