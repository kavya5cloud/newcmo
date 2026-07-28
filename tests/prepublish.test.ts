import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validate, optimize, deterministicOptimize, prePublish } from "@/lib/automation/prepublish";
import { createAdapterRegistry } from "@/lib/social/registry";

// The one pre-publish pipeline. What is pinned here is the boundary between "may not
// publish" and "could be better": only validation errors block, and optimisation failing
// never takes an account offline.

const KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

describe("validation", () => {
  it("blocks empty content", () => {
    const r = validate({ text: "   ", assetIds: [] }, { platform: "x" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "empty")).toBe(true);
  });

  it("blocks content over the platform's real adapter limit", () => {
    const limit = createAdapterRegistry().get("x")!.constraints().maxText;
    const r = validate({ text: "a".repeat(limit + 1), assetIds: [] }, { platform: "x" });
    expect(r.ok).toBe(false);
    const issue = r.errors.find((e) => e.code === "over_limit")!;
    expect(issue.message).toContain(String(limit));
  });

  it("blocks a media-required platform with no media", () => {
    const r = validate({ text: "hello, try it", assetIds: [] }, { platform: "instagram_business" });
    expect(r.errors.some((e) => e.code === "media_required")).toBe(true);
  });

  it("blocks too many assets for the platform", () => {
    const max = createAdapterRegistry().get("x")!.constraints().maxAssets;
    const r = validate({ text: "try it", assetIds: Array.from({ length: max + 1 }, (_, i) => `a${i}`) }, { platform: "x" });
    expect(r.errors.some((e) => e.code === "too_many_assets")).toBe(true);
  });

  it("blocks a malformed link rather than posting a dead one", () => {
    const r = validate({ text: "read this https://not-a-host try it", assetIds: [] }, { platform: "x" });
    expect(r.errors.some((e) => e.code === "invalid_url")).toBe(true);
  });

  it("warns about http links without blocking", () => {
    const r = validate({ text: "read this http://example.com and try it", assetIds: [] }, { platform: "x" });
    expect(r.warnings.some((w) => w.code === "insecure_url")).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("warns about missing alt text but never blocks on it", () => {
    // Accessibility must be visible; refusing to publish over it trains people to bypass.
    const r = validate({ text: "try it", assetIds: ["img1"] }, { platform: "linkedin" });
    expect(r.warnings.some((w) => w.code === "missing_alt_text")).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("accepts supplied alt text", () => {
    const r = validate({ text: "try it", assetIds: ["img1"], altText: { img1: "A dashboard" } }, { platform: "linkedin" });
    expect(r.warnings.some((w) => w.code === "missing_alt_text")).toBe(false);
  });

  it("warns when there is no call to action", () => {
    const r = validate({ text: "We shipped a thing today.", assetIds: [] }, { platform: "x" });
    expect(r.warnings.some((w) => w.code === "missing_cta")).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("survives content arriving without an assetIds array", () => {
    // Six sources feed this; a missing array must validate, not throw inside publishing.
    const r = validate({ text: "Try it free." } as Parameters<typeof validate>[0], { platform: "x" });
    expect(r.ok).toBe(true);
  });

  it("recognises a call to action and stays quiet", () => {
    const r = validate({ text: "We shipped it. Try it free today.", assetIds: [] }, { platform: "x" });
    expect(r.warnings.some((w) => w.code === "missing_cta")).toBe(false);
  });

  it("blocks content identical to something already scheduled", () => {
    const r = validate(
      { text: "We shipped an AI CMO. Try it!", assetIds: [] },
      { platform: "x", scheduledTexts: ["we shipped an ai cmo try it"] },
    );
    expect(r.errors.some((e) => e.code === "duplicate_content")).toBe(true);
  });

  it("separates errors from warnings so nothing fails silently", () => {
    const r = validate({ text: "", assetIds: ["a1"] }, { platform: "linkedin" });
    expect(r.issues.length).toBe(r.errors.length + r.warnings.length);
    expect(r.issues.every((i) => i.message.length > 10)).toBe(true);
  });
});

describe("deterministic optimiser", () => {
  it("trims to the platform limit at a sentence boundary", () => {
    const long = "This is a sentence. ".repeat(40);
    const o = deterministicOptimize({ text: long, assetIds: [] }, "x");
    expect(o.optimized.text.length).toBeLessThanOrEqual(280);
    expect(o.optimized.text.trimEnd().endsWith(".")).toBe(true);
    expect(o.applied.join(" ")).toContain("280");
  });

  it("generates alt text rather than leaving an image undescribed", () => {
    const o = deterministicOptimize({ text: "Our new dashboard. Try it.", assetIds: ["img1"] }, "linkedin");
    expect(o.optimized.altText?.img1?.length).toBeGreaterThan(0);
    expect(o.applied.some((a) => a.includes("img1"))).toBe(true);
  });

  it("never overwrites the original", () => {
    const original = { text: "x".repeat(500), assetIds: [] };
    const o = deterministicOptimize(original, "x");
    expect(o.original.text).toHaveLength(500);
    expect(o.optimized.text.length).toBeLessThan(500);
  });
});

describe("fallback", () => {
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it("falls back to the deterministic optimiser with no provider configured", async () => {
    const o = await optimize({ text: "We shipped it. Try it.", assetIds: [] }, { platform: "x" });
    expect(o.source).toBe("deterministic");
    expect(o.provider).toBeNull();
  });

  it("honours cancellation without blocking the publish", async () => {
    const c = new AbortController();
    c.abort();
    const o = await optimize({ text: "hello", assetIds: [] }, { platform: "x", signal: c.signal });
    expect(o.source).toBe("deterministic");
    expect(o.optimized.text.length).toBeGreaterThan(0);
  });

  it("optimisation failing never blocks a publishable post", async () => {
    const r = await prePublish({ text: "We shipped it. Try it free.", assetIds: [] }, { platform: "x" });
    expect(r.publishable).not.toBeNull();
    expect(r.validation.ok).toBe(true);
  });
});

describe("the pipeline", () => {
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it("optimises before validating, so an over-long post is fixed rather than refused", async () => {
    const long = "This is a sentence. ".repeat(40);
    const r = await prePublish({ text: long, assetIds: [] }, { platform: "x" });
    expect(r.before.ok).toBe(false);          // the original would have been rejected
    expect(r.validation.ok).toBe(true);       // what actually publishes is fine
    expect(r.publishable).not.toBeNull();
  });

  it("still blocks what optimisation cannot fix", async () => {
    // No optimiser can invent media for a platform that requires it.
    const r = await prePublish({ text: "Try it free.", assetIds: [] }, { platform: "instagram_business" });
    expect(r.publishable).toBeNull();
    expect(r.validation.errors.some((e) => e.code === "media_required")).toBe(true);
  });

  it("keeps both versions so a user can compare", async () => {
    const long = "This is a sentence. ".repeat(40);
    const r = await prePublish({ text: long, assetIds: [] }, { platform: "x" });
    expect(r.optimization.original.text).toBe(long);
    expect(r.optimization.optimized.text).not.toBe(long);
  });

  it("blocks a duplicate even after optimisation", async () => {
    const text = "We shipped an AI CMO. Try it free.";
    const r = await prePublish({ text, assetIds: [] }, { platform: "x", scheduledTexts: [text] });
    expect(r.publishable).toBeNull();
    expect(r.validation.errors.some((e) => e.code === "duplicate_content")).toBe(true);
  });

  it("reports what it changed", async () => {
    const r = await prePublish({ text: "Our dashboard. Try it.", assetIds: ["img1"] }, { platform: "linkedin" });
    expect(r.optimization.applied.length).toBeGreaterThan(0);
    expect(r.optimization.reasoning.length).toBeGreaterThan(0);
  });
});
