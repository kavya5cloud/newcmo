import { describe, it, expect } from "vitest";
import { compose, buildVariants, buildHashtags, buildSchedule, isContentFormat } from "@/lib/content/compose";
import { createAdapterRegistry } from "@/lib/social/registry";
import { generateUgc, generateHooks, generateScript, decideVersion, editVersion } from "@/lib/ugc/engine";
import { InMemoryUgcRepo } from "@/lib/ugc/store";
import { FORMAT_META, type UgcBrief } from "@/lib/ugc/types";
import type { SocialPlatform } from "@/lib/social/types";

// Content creation: the one-prompt composer and the UGC workflow. Deterministic, so an
// approved draft is the draft that ships.

const PROMPT = "We shipped an AI CMO that plans and publishes a whole launch from one mission";
const PLATFORMS: SocialPlatform[] = ["linkedin", "x", "instagram_business"];

describe("composer", () => {
  const base = { tenant: "t", prompt: PROMPT, audience: "seed-stage founders", platforms: PLATFORMS, now: 1_000_000 };

  it("is deterministic — the same prompt gives the same plan", () => {
    expect(compose({ ...base, format: "post" })).toEqual(compose({ ...base, format: "post" }));
  });

  it("writes genuinely different structures per format, not one text relabelled", () => {
    const post = compose({ ...base, format: "post" }).body;
    const thread = compose({ ...base, format: "thread" }).body;
    const blog = compose({ ...base, format: "blog" }).body;
    expect(new Set([post, thread, blog]).size).toBe(3);
    expect(thread).toMatch(/^1\//);
    expect(blog).toContain("## ");
  });

  it("builds the piece out of the prompt's own words", () => {
    const c = compose({ ...base, format: "post" });
    expect(c.body.toLowerCase()).toContain("ai cmo");
    expect(c.body).toContain("seed-stage founders");
  });

  it("sizes every variant to that platform's real adapter limit", () => {
    const registry = createAdapterRegistry();
    for (const v of compose({ ...base, format: "blog" }).variants) {
      const real = registry.get(v.platform)!.constraints().maxText;
      expect(v.limit).toBe(real);
      expect(v.text.length).toBeLessThanOrEqual(real);
    }
  });

  it("cuts at a sentence boundary rather than mid-word, and says it cut", () => {
    const long = "This is a sentence. ".repeat(40);
    const [x] = buildVariants(long, ["x"]);           // X allows 280 characters
    expect(x.fits).toBe(false);
    expect(x.text.length).toBeLessThanOrEqual(280);
    expect(x.text.trimEnd().endsWith(".")).toBe(true);
    expect(x.note).toContain("280");
  });

  it("flags platforms that require media, so nothing is queued that cannot post", () => {
    const ig = compose({ ...base, format: "post" }).variants.find((v) => v.platform === "instagram_business")!;
    expect(ig.requiresAsset).toBe(true);
  });

  it("builds no variants when nothing is connected, instead of inventing platforms", () => {
    const c = compose({ ...base, format: "post", platforms: [] });
    expect(c.variants).toHaveLength(0);
    expect(c.schedule).toHaveLength(0);
  });

  it("de-duplicates platforms — two accounts on one platform is one variant", () => {
    expect(buildVariants("hello", ["linkedin", "linkedin"])).toHaveLength(1);
  });

  it("staggers the schedule and explains each slot", () => {
    const slots = buildSchedule(PLATFORMS, 1_000_000);
    expect(new Set(slots.map((s) => s.at)).size).toBe(slots.length);
    expect(slots.every((s) => s.rationale.length > 0)).toBe(true);
    // Platforms the window model doesn't cover must say so rather than claim a best time.
    expect(slots.find((s) => s.platform === "instagram_business")!.rationale).toContain("No posting-window data");
  });

  it("derives hashtags from the prompt, never boilerplate", () => {
    const tags = buildHashtags(PROMPT, "seed-stage founders");
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((t) => t.startsWith("#") && t.length > 2)).toBe(true);
    expect(tags.join(" ")).toMatch(/shipped|launch|mission|publishes|founders/);
  });

  it("rejects a format it does not support", () => {
    expect(isContentFormat("post")).toBe(true);
    expect(isContentFormat("tiktok_dance")).toBe(false);
  });
});

describe("UGC engine", () => {
  const brief: UgcBrief = {
    product: "Populr", audience: "seed-stage founders",
    outcome: "a launch plan without a marketing hire",
    format: "testimonial", creatorStyle: "founder", voiceStyle: "conversational",
  };

  it("is deterministic", () => {
    expect(generateUgc("t", brief, { now: 1 })).toEqual(generateUgc("t", brief, { now: 1 }));
  });

  it("ranks hooks and explains each one", () => {
    const hooks = generateHooks(brief);
    expect(hooks.length).toBeGreaterThan(2);
    expect(hooks.every((h) => h.rationale.length > 20)).toBe(true);
    for (let i = 1; i < hooks.length; i++) expect(hooks[i - 1].strength).toBeGreaterThanOrEqual(hooks[i].strength);
  });

  it("only offers the objection hook when an objection was given", () => {
    const without = generateHooks(brief).map((h) => h.text);
    const withObjection = generateHooks({ ...brief, objection: "it can't know my brand" }).map((h) => h.text);
    expect(without.some((t) => t.includes("that's what I thought too"))).toBe(false);
    expect(withObjection.some((t) => t.includes("that's what I thought too"))).toBe(true);
  });

  it("scripts are built from the brief, not stock lines", () => {
    const [hook] = generateHooks(brief);
    const scenes = generateScript(brief, hook);
    const text = scenes.map((s) => s.line).join(" ");
    expect(text).toContain("Populr");
    expect(text).toContain("seed-stage founders");
    expect(scenes.every((s) => s.visual.length > 0)).toBe(true);
  });

  it("never mangles casing when a style prefixes the hook", () => {
    // Regression: an acronym hook ("AI cannot…") was being lowercased into "aI cannot…".
    const withAcronym = generateUgc("t", { ...brief, objection: "AI cannot learn my brand" }, { versions: 1, now: 1 });
    const opening = withAcronym.versions[0].scenes[0].line;
    expect(opening).not.toMatch(/\baI\b/);
    expect(opening).toContain("AI cannot learn my brand");
  });

  it("scene timings fit the format's duration", () => {
    const [hook] = generateHooks(brief);
    const scenes = generateScript(brief, hook);
    expect(scenes[0].at).toBe(0);
    expect(scenes[scenes.length - 1].at).toBeLessThan(FORMAT_META.testimonial.seconds);
  });

  it("each format writes a different script", () => {
    const [hook] = generateHooks(brief);
    const bodies = (["testimonial", "product_demo", "comparison"] as const)
      .map((f) => generateScript({ ...brief, format: f }, hook).map((s) => s.line).join(" "));
    expect(new Set(bodies).size).toBe(3);
  });

  it("versions differ in creator and voice style, not just label", () => {
    const pkg = generateUgc("t", brief, { versions: 3, now: 1 });
    expect(pkg.versions).toHaveLength(3);
    expect(pkg.versions[0].label).toBe("As briefed");
    expect(pkg.versions[0].creatorStyle).toBe(brief.creatorStyle);
    const opens = pkg.versions.map((v) => v.scenes[0].line);
    expect(new Set(opens).size).toBeGreaterThan(1);
  });

  it("caps versions at five so a founder is choosing, not wading", () => {
    expect(generateUgc("t", brief, { versions: 99, now: 1 }).versions).toHaveLength(5);
    expect(generateUgc("t", brief, { versions: 0, now: 1 }).versions).toHaveLength(1);
  });

  it("every version ships a caption, hashtags and voice direction", () => {
    for (const v of generateUgc("t", brief, { versions: 3, now: 1 }).versions) {
      expect(v.caption.length).toBeGreaterThan(10);
      expect(v.hashtags.length).toBeGreaterThan(0);
      expect(v.voiceDirection.length).toBeGreaterThan(20);
      expect(v.status).toBe("draft");
    }
  });

  it("approval is per version and does not mutate the package given", () => {
    const pkg = generateUgc("t", brief, { versions: 2, now: 1 });
    const next = decideVersion(pkg, pkg.versions[0].id, "approved", 5);
    expect(pkg.versions[0].status).toBe("draft");
    expect(next.versions[0].status).toBe("approved");
    expect(next.versions[1].status).toBe("draft");
  });

  it("editing a caption or a line recomputes the word count", () => {
    const pkg = generateUgc("t", brief, { versions: 1, now: 1 });
    const v = pkg.versions[0];
    const next = editVersion(pkg, v.id, { caption: "new caption", scenes: [{ index: 0, line: "one two three" }] }, 9);
    expect(next.versions[0].caption).toBe("new caption");
    expect(next.versions[0].scenes[0].line).toBe("one two three");
    expect(next.versions[0].wordCount).not.toBe(v.wordCount);
    expect(pkg.versions[0].caption).not.toBe("new caption");
  });
});

describe("UGC store", () => {
  it("round-trips and is scoped per tenant", async () => {
    const repo = new InMemoryUgcRepo();
    const pkg = generateUgc("a", {
      product: "P", audience: "founders", outcome: "faster launches",
      format: "product_demo", creatorStyle: "expert", voiceStyle: "calm",
    }, { now: 1 });
    await repo.save(pkg);
    expect((await repo.get("a", pkg.id))?.id).toBe(pkg.id);
    expect(await repo.get("b", pkg.id)).toBeNull();
    expect(await repo.list("a")).toHaveLength(1);
  });
});
