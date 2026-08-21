import { describe, expect, it } from "vitest";
import { InMemoryReferenceRepo } from "@/lib/intelligence/store";
import { selectReferences, referencesToPrompt, terms } from "@/lib/intelligence/retrieve";
import { assertCitable, type NewReference, type Reference } from "@/lib/intelligence/types";
import { SEED } from "@/lib/intelligence/seed";

// The corpus is the one place an unsourced number does the most damage: written once, read
// into every prompt, and repeated back to customers in their own voice as research. These
// pin the rules that stop that, and the scoping that stops one workspace reading another's.

const ref = (over: Partial<Reference> = {}): Reference => ({
  id: over.id ?? "r1", kind: "principle", workspaceKey: null,
  pattern: "Name the problem before naming the product",
  evidence: "A viewer who does not recognise the problem has no reason to read on.",
  excerpt: null, metrics: [], channel: null, industry: null, audience: null, tags: [],
  source: { name: "Populr", url: null, licence: "original", observedAt: null },
  createdAt: 0, ...over,
});

const withMetric = (over: Partial<NewReference> = {}): NewReference => ({
  kind: "ad", workspaceKey: null, pattern: "Short hooks win",
  evidence: "observed", excerpt: null,
  metrics: [{ label: "CTR", value: "2.4%", baseline: "1.1% category median" }],
  source: { name: "Someone", url: null, licence: "licensed", observedAt: null },
  channel: "ads", industry: null, audience: null, tags: [], ...over,
});

describe("a reference may not assert a number it cannot source", () => {
  it("refuses a metric with no source URL", () => {
    expect(() => assertCitable(withMetric())).toThrow(/no source URL/);
  });

  it("accepts the same claim once it can be checked", () => {
    expect(() => assertCitable(withMetric({
      source: { name: "Someone", url: "https://example.com/study", licence: "licensed", observedAt: null },
    }))).not.toThrow();
  });

  it("lets the customer's own measured data through — it is their number", () => {
    expect(() => assertCitable(withMetric({
      workspaceKey: "user:a",
      source: { name: "Your LinkedIn", url: null, licence: "first_party", observedAt: 1 },
    }))).not.toThrow();
  });

  it("says which row was rejected instead of dropping it silently", async () => {
    const repo = new InMemoryReferenceRepo();
    const clean: NewReference = { ...withMetric(), metrics: [] };
    const out = await repo.addMany([withMetric(), clean]);
    expect(out.added).toBe(1);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].pattern).toContain("Short hooks win");
  });

  it("holds for the seed corpus we ship", () => {
    for (const s of SEED) expect(() => assertCitable(s)).not.toThrow();
  });
});

describe("retrieval sees only what this workspace may see", () => {
  const all = [
    ref({ id: "shared", workspaceKey: null }),
    ref({ id: "mine", workspaceKey: "user:a", pattern: "My own winning hook problem" }),
    ref({ id: "theirs", workspaceKey: "user:b", pattern: "Their own winning hook problem" }),
  ];

  it("never returns another workspace's private rows", () => {
    const got = selectReferences(all, { workspaceKey: "user:a", terms: ["hook", "problem"] });
    expect(got.map((r) => r.id)).not.toContain("theirs");
  });

  it("ranks the business's own data above the shared library", () => {
    const got = selectReferences(all, { workspaceKey: "user:a", terms: ["hook", "problem"] });
    expect(got[0].id).toBe("mine");
  });

  it("treats the wrong channel as a no, not a weak match", () => {
    const adOnly = [ref({ id: "ad", channel: "ads", pattern: "sound off creative" })];
    expect(selectReferences(adOnly, { workspaceKey: "user:a", channel: "linkedin", terms: ["sound"] })).toEqual([]);
    expect(selectReferences(adOnly, { workspaceKey: "user:a", channel: "ads", terms: ["sound"] })).toHaveLength(1);
  });

  it("keeps a general principle available to any channel", () => {
    const general = [ref({ id: "gen", channel: null, pattern: "specificity cannot be copied" })];
    expect(selectReferences(general, { workspaceKey: "user:a", channel: "linkedin", terms: ["specificity"] })).toHaveLength(1);
  });

  it("does not return five of the same kind", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      ref({ id: `ad${i}`, kind: "ad", channel: "ads", pattern: `hook variant ${i} problem` }));
    const got = selectReferences(many, { workspaceKey: "user:a", channel: "ads", terms: ["problem"], limit: 5 });
    expect(got.length).toBeLessThanOrEqual(2);
  });

  it("returns the same references for the same brief", () => {
    const q = { workspaceKey: "user:a", terms: ["hook", "problem"] };
    expect(selectReferences(all, q).map((r) => r.id)).toEqual(selectReferences(all, q).map((r) => r.id));
  });

  it("ignores stop words, which would otherwise match everything", () => {
    expect(terms(["write a post about the product"])).not.toContain("the");
    expect(terms(["write a post about the product"])).toContain("product");
  });
});

describe("what the prompt is told about a reference", () => {
  it("attributes every number, so it cannot become this business's own result", () => {
    const p = referencesToPrompt([ref({
      metrics: [{ label: "CTR", value: "2.4%", baseline: "1.1% median" }],
      source: { name: "Acme case study", url: "https://example.com", licence: "licensed", observedAt: null },
    })]);
    expect(p).toContain("Acme case study");
    expect(p).toMatch(/Never state one as this business's own result/);
  });

  it("asks for the technique, not the text — a corpus without this produces paraphrase", () => {
    expect(referencesToPrompt([ref()])).toMatch(/craft, not as copy/);
  });

  it("says nothing at all when there are no references", () => {
    expect(referencesToPrompt([])).toBe("");
  });
});
