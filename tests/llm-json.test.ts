import { describe, it, expect } from "vitest";
import { extractJson, tryExtractJson, LlmJsonError } from "@/lib/llm-json";

// The old inline parseJSON (indexOf("{") … lastIndexOf("}")) for regression comparison.
function legacyParse(txt: string) {
  const clean = txt.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(s, e + 1));
}

describe("extractJson — happy paths", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"name":"Stripe"}')).toEqual({ name: "Stripe" });
  });

  it("strips markdown fences", () => {
    expect(extractJson('```json\n{"name":"Stripe"}\n```')).toEqual({ name: "Stripe" });
  });

  it("ignores prose before and after", () => {
    expect(extractJson('Sure! Here is the JSON:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it("handles nested objects and arrays", () => {
    const t = '{"competitors":["a","b"],"meta":{"x":{"y":2}}}';
    expect(extractJson(t)).toEqual({ competitors: ["a", "b"], meta: { x: { y: 2 } } });
  });

  it("handles braces inside strings", () => {
    expect(extractJson('{"desc":"uses {curly} braces","n":1}')).toEqual({ desc: "uses {curly} braces", n: 1 });
  });

  it("handles escaped quotes inside strings", () => {
    expect(extractJson('{"q":"she said \\"hi\\"","n":2}')).toEqual({ q: 'she said "hi"', n: 2 });
  });

  it("parses top-level arrays", () => {
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("tolerates trailing commas", () => {
    expect(extractJson('{"a":1,"b":2,}')).toEqual({ a: 1, b: 2 });
  });
});

describe("extractJson — truncation repair (the production failure)", () => {
  it("repairs a reply cut off mid-string", () => {
    // token cap hit while writing `description`
    const truncated = '{"name":"Stripe","oneLiner":"payments","description":"Stripe is a financial infra';
    expect(() => legacyParse(truncated)).toThrow();            // old code broke here
    const out = extractJson<{ name: string; description: string }>(truncated);
    expect(out.name).toBe("Stripe");
    expect(out.description).toContain("Stripe is a financial infra");
  });

  it("repairs truncation after a nested object — the case lastIndexOf('}') got wrong", () => {
    // The last `}` closes the NESTED object, so the legacy slice produced invalid JSON.
    const truncated = '{"feed":{"reddit":{"summary":"note","items":[["a","Draft"]]}},"rankings":[{"pos":"#3"';
    expect(() => legacyParse(truncated)).toThrow();
    const out = extractJson<{ feed: Record<string, unknown>; rankings: unknown[] }>(truncated);
    expect(out.feed).toBeTruthy();
    expect(Array.isArray(out.rankings)).toBe(true);
  });

  it("drops a dangling key with no value", () => {
    const truncated = '{"name":"Acme","audience":';
    const out = extractJson<{ name: string }>(truncated);
    expect(out.name).toBe("Acme");
    expect("audience" in out).toBe(false);
  });

  it("repairs a truncated array of objects", () => {
    const truncated = '{"rankings":[{"pos":"#1","query":"ai cmo"},{"pos":"#2","que';
    const out = extractJson<{ rankings: { pos: string }[] }>(truncated);
    expect(out.rankings[0].pos).toBe("#1");
  });
});

describe("extractJson — stray value strings (the live trypopulr.in failure)", () => {
  // Verbatim shape of the real linear.app response that broke analyse in production:
  // the model emitted three bare strings for the single-string `voice` field.
  const real = '{"name":"Linear","oneLiner":"issue tracking","audience":"product teams",' +
    '"positioning":"Fast by default.","competitors":["Asana", "Jira", "Trello", "Notion"],' +
    '"voice":"modern", "innovative", "collaborative","description":"Linear is a system."}';

  it("legacy parser choked on it (this is what users hit)", () => {
    // V8: "Expected ':' after property name" — the stray string lands in key position.
    expect(() => legacyParse(real)).toThrow(/Expected ':'/);
  });

  it("folds the stray strings back into the value", () => {
    const p = extractJson<{ voice: string; name: string; description: string }>(real);
    expect(p.name).toBe("Linear");
    expect(p.voice).toBe("modern, innovative, collaborative");
    expect(p.description).toBe("Linear is a system.");
  });

  it("does NOT damage real arrays while doing so", () => {
    const p = extractJson<{ competitors: string[] }>(real);
    expect(p.competitors).toEqual(["Asana", "Jira", "Trello", "Notion"]);
  });

  it("leaves well-formed objects untouched", () => {
    const good = '{"a":"one","b":["x","y"],"c":{"d":"z"}}';
    expect(extractJson(good)).toEqual({ a: "one", b: ["x", "y"], c: { d: "z" } });
  });
});

describe("extractJson — clear errors instead of 'Unexpected end of JSON input'", () => {
  it("reports prose-only replies as no_json", () => {
    try {
      extractJson("I'm sorry, I can't access that website.");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LlmJsonError);
      const err = e as LlmJsonError;
      expect(err.reason).toBe("no_json");
      expect(err.message).toContain("without any JSON");
      expect(err.sample).toContain("can't access");
    }
  });

  it("empty output is a clear no_json error, not a cryptic parse crash", () => {
    expect(() => extractJson("")).toThrow(LlmJsonError);
    // the legacy version threw the useless "Unexpected end of JSON input"
    expect(() => legacyParse("")).toThrow(/Unexpected end of JSON input|Unexpected token/);
  });

  it("tryExtractJson returns null instead of throwing", () => {
    expect(tryExtractJson("no json here")).toBeNull();
    expect(tryExtractJson('{"ok":true}')).toEqual({ ok: true });
  });
});
