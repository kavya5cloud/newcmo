import { describe, it, expect } from "vitest";
import { validateAssetGraph } from "../lib/services/asset-validate";

const blog = { clientKey: "blog", parentKey: null, assetType: "blog", title: "Cornerstone post", body: "x".repeat(50) };
const li = { clientKey: "li", parentKey: "blog", assetType: "linkedin_post", title: "LI", body: "y".repeat(50) };

describe("validateAssetGraph", () => {
  it("accepts a root + derived child", () => {
    const r = validateAssetGraph([blog, li]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(2);
      expect(r.value[1].channel).toBe("linkedin"); // channel derived from assetType
    }
  });

  it("rejects an empty graph", () => {
    expect(validateAssetGraph([]).ok).toBe(false);
  });

  it("rejects an unknown asset type", () => {
    const r = validateAssetGraph([{ ...blog, assetType: "tiktok_dance" }]);
    expect(r.ok).toBe(false);
  });

  it("rejects a too-short body", () => {
    const r = validateAssetGraph([{ ...blog, body: "too short" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("body"))).toBe(true);
  });

  it("rejects a dangling parent edge (graph integrity)", () => {
    const orphan = { ...li, parentKey: "nonexistent" };
    const r = validateAssetGraph([blog, orphan]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.startsWith("parent:"))).toBe(true);
  });

  it("rejects duplicate clientKeys", () => {
    const r = validateAssetGraph([blog, { ...li, clientKey: "blog" }]);
    expect(r.ok).toBe(false);
  });

  it("preserves typed structure (e.g. x_thread tweets)", () => {
    const thread = { clientKey: "x", parentKey: "blog", assetType: "x_thread", title: "T", body: "z".repeat(50), structure: { tweets: ["a", "b"] } };
    const r = validateAssetGraph([blog, thread]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[1].structure).toEqual({ tweets: ["a", "b"] });
  });
});
