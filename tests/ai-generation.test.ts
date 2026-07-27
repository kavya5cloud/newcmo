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
