import { describe, it, expect } from "vitest";
import { buildSpecification } from "@/lib/creative-intelligence/spec-builder";
import { validateSpecification, assertValidSpecification } from "@/lib/creative-intelligence/spec-validator";
import { toProviderSpec } from "@/lib/creative-intelligence/contract";
import type { CreativeBriefInput } from "@/lib/creative/types";

const brief: CreativeBriefInput = {
  objective: "Launch", audience: "founders", keyMessage: "an AI CMO that reasons", emotionalAngle: "calm confidence",
  proof: "deterministic engine", cta: "join early access", visualDirection: "clean", successMetric: "signups",
};

describe("Spec Validation", () => {
  it("accepts a fully-built specification", () => {
    const spec = buildSpecification({ assetType: "hero_video", brief });
    const v = validateSpecification(spec);
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
  });

  it("rejects a spec missing required fields", () => {
    const spec = buildSpecification({ assetType: "hero_video", brief });
    const broken = { ...spec, audience: "", channel: "" as never, visualDirection: undefined as never };
    const v = validateSpecification(broken);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.field)).toContain("audience");
    expect(v.errors.map((e) => e.field)).toContain("visualDirection");
  });

  it("requires a story for video/motion modalities", () => {
    const spec = buildSpecification({ assetType: "hero_video", brief });
    const broken = { ...spec, storyStructure: null };
    const v = validateSpecification(broken);
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.field)).toContain("storyStructure");
  });

  it("assertValidSpecification throws on an invalid spec", () => {
    const spec = buildSpecification({ assetType: "hero_video", brief });
    expect(() => assertValidSpecification({ ...spec, id: "" })).toThrow();
  });

  it("contract refuses to normalize an invalid spec", () => {
    const spec = buildSpecification({ assetType: "hero_video", brief });
    expect(() => toProviderSpec({ ...spec, visualDirection: undefined as never })).toThrow();
  });
});
