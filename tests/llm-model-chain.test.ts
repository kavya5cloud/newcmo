import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@/lib/services/llm";

// Production logs from 2026-08-08 showed every request walking a chain of models that could
// never answer it, then landing on the weakest one in the list. That is the whole reason the
// CMO's answers got worse: the good model was never reached.
//
//   gemini-2.5-flash   404  "no longer available to new users"
//   gemini-2.0-flash   429  "limit: 0"          — free tier grants zero
//   llama-3.3-70b      429  "Limit 100000, Used 99999"  — day's budget gone
//   llama-4-scout      404  "does not exist or you do not have access to it"
//   compound-mini      429  — and its error named llama-3.3-70b
//
// Four of those five cost a network round-trip and could not have succeeded.

const modelsOf = (name: string) => PROVIDERS.find((p) => p.name === name)!.models;

describe("the model chain only lists models that can answer", () => {
  it("does not ship a model the account has no access to", () => {
    // 404 model_not_found on every call since the key was created.
    expect(modelsOf("groq")).not.toContain("meta-llama/llama-4-scout-17b-16e-instruct");
  });

  it("does not fall back to a model that shares the quota it is falling back from", () => {
    // compound-mini's own 429 named llama-3.3-70b-versatile — it routes there, so it is
    // exhausted at exactly the moment it would be needed. A fallback that fails with the
    // lead model is not a fallback.
    expect(modelsOf("groq")).not.toContain("groq/compound-mini");
  });

  it("still degrades rather than dying when the lead model is rate limited", () => {
    const groq = modelsOf("groq");
    expect(groq[0]).toBe("llama-3.3-70b-versatile");
    expect(groq).toContain("llama-3.1-8b-instant");
    expect(groq.length).toBeGreaterThan(1);
  });

  it("defaults Gemini to a model that was actually tested, not assumed", () => {
    // The old default was gemini-2.5-flash, which answered 404 "no longer available to new
    // users". Anyone setting GEMINI_API_KEY without also setting GEMINI_MODEL therefore put
    // a dead model at the front of the chain. gemini-3.6-flash was verified returning 200
    // against a live key before being made the default.
    expect(modelsOf("gemini")[0]).toBe("gemini-3.6-flash");
  });

  it("pins a version rather than following an alias", () => {
    // gemini-flash-latest silently swaps the underlying model. The prompt rules are tuned
    // against observed behaviour, so a model changing with nothing in the diff is how
    // "the AI got worse again" happens with no way to bisect it.
    for (const m of modelsOf("gemini")) {
      expect(m, `${m} is a moving alias`).not.toMatch(/-latest$/);
    }
  });

  it("keeps non-text models out of the chain", () => {
    // The key also lists image, tts, embedding and robotics models. Any of them in the
    // chain fails or returns a shape the parser cannot read.
    for (const p of PROVIDERS) {
      for (const m of p.models) {
        expect(m, `${m} is not a text model`).not.toMatch(/-image|-tts|embedding|robotics|computer-use/);
      }
    }
  });

  it("never lists the same model twice", () => {
    for (const p of PROVIDERS) {
      expect(new Set(p.models).size, `${p.name} repeats a model`).toBe(p.models.length);
    }
  });

  it("leaves every provider with somewhere to go", () => {
    for (const p of PROVIDERS) expect(p.models.length, `${p.name} has no models`).toBeGreaterThan(0);
  });
});
