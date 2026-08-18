import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { contextToPrompt, type GenerationContext } from "@/lib/content/generation-context";

// The LLM generation path. What matters here is the contract around the model, not the
// model: that a missing key degrades honestly, that platform limits are enforced on model
// output rather than trusted, and that the prompt names what it does not know.

const ctx = (over: Partial<GenerationContext> = {}): GenerationContext => ({
  tenant: "t",
  brand: { name: "Populr", voice: ["tone: direct"] },
  audience: "seed-stage founders",
  market: { headline: "h", trends: ["ai cmo (80% confidence)"], competitors: ["Okara: daily"], opportunities: ["own the term → publish"], keywords: ["ai cmo"] },
  memory: ["trend/ai cmo: rising"],
  learned: { patterns: ["hook: question performs 80%"], insights: [] },
  platforms: [{ platform: "x", maxText: 280, maxAssets: 4, requiresAsset: false, allowsVideo: true }],
  previousCampaigns: [],
  missing: [],
  ...over,
});

describe("generation context prompt", () => {
  it("carries every context source the generation is supposed to use", () => {
    const p = contextToPrompt(ctx());
    for (const marker of ["AUDIENCE", "BRAND VOICE", "TRENDS", "COMPETITORS", "OPPORTUNITIES", "KEYWORDS", "PREVIOUSLY OBSERVED", "WHAT HAS PERFORMED BEFORE"]) {
      expect(p, `missing ${marker}`).toContain(marker);
    }
  });

  it("states each platform's hard limit so the model writes to it", () => {
    expect(contextToPrompt(ctx())).toContain("max 280 characters");
  });

  it("names missing sources instead of quietly omitting them", () => {
    // A model that never saw the heading invents; one told the data is missing does not.
    const p = contextToPrompt(ctx({ missing: ["market intelligence", "brand DNA"] }));
    expect(p).toContain("UNAVAILABLE THIS RUN: market intelligence, brand DNA");
    expect(p).toContain("Do not invent facts");
  });

  it("says so plainly when nothing is connected", () => {
    expect(contextToPrompt(ctx({ platforms: [] }))).toContain("CONNECTED PLATFORMS: none yet.");
  });
});

describe("graceful degradation", () => {
  const KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } vi.restoreAllMocks(); });

  it("composes with the built-in engine and says why when no provider is configured", async () => {
    const { composeWithAi } = await import("@/lib/content/ai");
    const r = await composeWithAi({
      tenant: "t", prompt: "we shipped an AI CMO", format: "post",
      audience: "founders", platforms: ["x"], now: 1_000_000,
    });
    expect(r.source).toBe("deterministic");
    expect(r.provider).toBeNull();
    expect(r.degradedReason).toContain("No AI provider is configured");
    // Degraded still means usable: a founder gets a draft, not an error page.
    expect(r.composed.body.length).toBeGreaterThan(10);
    expect(r.composed.variants).toHaveLength(1);
    // And it does not flatter itself.
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("scripts UGC with the built-in engine and says why", async () => {
    const { generateUgcWithAi } = await import("@/lib/ugc/ai");
    const r = await generateUgcWithAi("t", {
      product: "Populr", audience: "founders", outcome: "a launch without a marketing hire",
      format: "testimonial", creatorStyle: "founder", voiceStyle: "calm",
    }, { versions: 2 });
    expect(r.source).toBe("deterministic");
    expect(r.package.versions).toHaveLength(2);
    expect(r.degradedReason).toContain("No AI provider is configured");
  });

  it("honours cancellation before it starts work", async () => {
    process.env.GROQ_API_KEY = "gsk_test_key_not_used_because_we_abort_first";
    const { composeWithAi } = await import("@/lib/content/ai");
    const controller = new AbortController();
    controller.abort();
    const r = await composeWithAi({
      tenant: "t", prompt: "hello", format: "post", audience: "founders", platforms: [], now: 1,
    }, { signal: controller.signal });
    expect(r.source).toBe("deterministic");
    expect(r.degradedReason).toMatch(/Cancelled/);
  });
});

// The product repeated itself for three separate reasons, all of them in this path: the
// cache was keyed on the prompt alone, the "already written" list was hardcoded empty, and
// the copy shared a temperature chosen to keep analysis factual. These pin all three.
describe("content has to be different tomorrow", () => {
  it("keys the same prompt differently once a salt is given", async () => {
    const { buildCacheKey } = await import("@/lib/ai-cache");
    const prompt = "write a post about pricing";
    // No salt is still the old behaviour, which analysis depends on.
    expect(buildCacheKey(null, prompt)).toBe(buildCacheKey(null, prompt));
    // A different day is a different request for writing.
    expect(buildCacheKey(null, prompt, "compose:2026-08-19:0"))
      .not.toBe(buildCacheKey(null, prompt, "compose:2026-08-20:0"));
    // And so is a re-roll on the same day, or "regenerate" returns what you rejected.
    expect(buildCacheKey(null, prompt, "compose:2026-08-19:0"))
      .not.toBe(buildCacheKey(null, prompt, "compose:2026-08-19:1"));
  });

  it("tells the model what it already wrote, as a prohibition rather than as material", () => {
    const p = contextToPrompt(ctx({
      previousCampaigns: [`"Pricing is a promise" — opened with: Most founders price from fear…`],
    }));
    expect(p).toContain("DO NOT REPEAT");
    expect(p).toContain("Pricing is a promise");
    // The instruction has to travel with the list. A bare heading reads as source material.
    expect(p).toMatch(/different angle and a different opening/i);
  });

  it("says nothing about repeats when there is nothing written yet", () => {
    expect(contextToPrompt(ctx({ previousCampaigns: [] }))).not.toContain("DO NOT REPEAT");
  });

  it("reads its own angles back into the next brief, and keeps them out of market memory", async () => {
    // The end-to-end shape of the fix: record an angle, assemble the next context, and it
    // must arrive as "already written" and NOT as a market observation — a "content" row
    // leaking into `memory` would invite the model to write ABOUT its own last post.
    const { recordComposedAngle } = await import("@/lib/content/generation-log");
    const { assembleGenerationContext } = await import("@/lib/content/generation-context");
    const { marketPlatform } = await import("@/lib/market/shared");
    const tenant = `t_${Math.random().toString(36).slice(2)}`;

    await marketPlatform().memory.record(
      (await import("@/lib/market/memory")).memoryRecord(tenant, "trend", "ai cmo", "rising", Date.now(), null),
    );
    await recordComposedAngle(tenant, { title: "Pricing is a promise", body: "Most founders price from fear" });

    const assembled = await assembleGenerationContext({ tenant, audience: "founders", terms: ["pricing"] });
    expect(assembled.previousCampaigns.join(" ")).toContain("Pricing is a promise");
    expect(assembled.memory.join(" ")).not.toContain("Pricing is a promise");
    expect(assembled.memory.join(" ")).toContain("ai cmo");
  });

  it("records the angle, not the post — a digest is what survives a year of generating", async () => {
    const { recordComposedAngle, dayKey } = await import("@/lib/content/generation-log");
    const { marketPlatform } = await import("@/lib/market/shared");
    const tenant = `t_${Math.random().toString(36).slice(2)}`;
    const body = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    await recordComposedAngle(tenant, { title: "Pricing is a promise", body }, Date.parse("2026-08-19T00:00:00Z"));

    const rows = await marketPlatform().memory.list(tenant, "content", 10);
    expect(rows.length).toBe(1);
    expect(rows[0].value).toContain("Pricing is a promise");
    expect(rows[0].value).toContain("word0");
    // The opener, not the body. 200 words in must not be there.
    expect(rows[0].value).not.toContain("word199");
    expect(rows[0].key).toContain(dayKey(Date.parse("2026-08-19T00:00:00Z")));
  });

  it("does not overwrite the morning's angle with the afternoon's", async () => {
    const { recordComposedAngle } = await import("@/lib/content/generation-log");
    const { marketPlatform } = await import("@/lib/market/shared");
    const tenant = `t_${Math.random().toString(36).slice(2)}`;
    const at = Date.parse("2026-08-19T09:00:00Z");
    await recordComposedAngle(tenant, { title: "First", body: "one two three" }, at);
    await recordComposedAngle(tenant, { title: "Second", body: "four five six" }, at);
    const rows = await marketPlatform().memory.list(tenant, "content", 10);
    expect(rows.length).toBe(2);
  });
});
