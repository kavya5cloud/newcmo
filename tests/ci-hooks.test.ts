import { describe, it, expect } from "vitest";
import { HOOK_LIBRARY, retrieveHooks, selectHook, renderHook } from "@/lib/creative-intelligence/hook-engine";
import { HOOK_CATEGORIES } from "@/lib/creative-intelligence/types";

describe("Hook Engine", () => {
  it("covers every category in the seed library", () => {
    for (const c of HOOK_CATEGORIES) {
      expect(HOOK_LIBRARY.some((h) => h.category === c)).toBe(true);
    }
  });

  it("retrieves best-first and respects a category filter", () => {
    const hooks = retrieveHooks({ category: "problem" }, undefined, 3);
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks[0].category).toBe("problem");
  });

  it("ranks by performance/relevance (channel match wins)", () => {
    const linkedin = retrieveHooks({ channel: "linkedin" }, undefined, 1)[0];
    expect(linkedin.channels).toContain("linkedin");
  });

  it("selectHook returns a single hook", () => {
    const h = selectHook({ channel: "video" });
    expect(h).not.toBeNull();
  });

  it("renders template slots", () => {
    const h = HOOK_LIBRARY.find((x) => x.template.includes("{audience}"))!;
    const out = renderHook(h, { audience: "makers", product: "Populr", pain: "manual posting", metric: "3x" });
    expect(out).not.toContain("{audience}");
    expect(out.toLowerCase()).toContain("makers");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(retrieveHooks({ channel: "x" }))).toBe(JSON.stringify(retrieveHooks({ channel: "x" })));
  });
});
