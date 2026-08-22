import { describe, expect, it } from "vitest";
import { scrubIdentity, asksAboutIdentity, IDENTITY_ANSWER } from "@/lib/cmo/identity";
import { IDENTITY_RULES, QUALITY_RULES, DELIVERABLE_RULES } from "@/lib/cmo/quality-rules";

// The design constraint that makes this hard: vendor names are not forbidden words. A
// customer selling developer tools competes with OpenAI, and a post about AI search has to
// be able to say Gemini. Only the model talking about *itself* gets removed.

describe("self-disclosure is removed", () => {
  const cases: [string, string][] = [
    ["as an ai", "As an AI language model, I can't browse the web. Post on Tuesday at 9am."],
    ["i am vendor", "I'm Gemini, developed by Google. Your title tag is too short."],
    ["trained by", "I am a large language model trained by OpenAI. Here is the plan."],
    ["powered by", "I'm powered by Groq. Your LinkedIn cadence is too low."],
    ["internals", "My training data has a cutoff. Publish the comparison page first."],
    ["no realtime", "I don't have access to real-time data. Your top query is 'ai cmo'."],
  ];

  for (const [name, input] of cases) {
    it(`removes ${name} and keeps the advice`, () => {
      const { text, findings } = scrubIdentity(input);
      expect(findings.length, input).toBeGreaterThan(0);
      for (const vendor of ["Gemini", "OpenAI", "Groq", "AI language model"]) {
        expect(text).not.toContain(vendor);
      }
      // The sentence that was actually about their marketing survives.
      expect(text.length).toBeGreaterThan(10);
    });
  }
});

describe("a vendor named as a subject is left alone", () => {
  // These are the false positives that would break real marketing copy.
  const safe = [
    "OpenAI raised a round last week — worth a post comparing your pricing to theirs.",
    "Your biggest competitor on Meta ads is Anthropic.",
    "Write a guide on how Gemini and ChatGPT surface product pages.",
    "Claude is the tool your audience already uses, so name it in the headline.",
    "Google ranks your comparison page third for that term.",
  ];

  for (const s of safe) {
    it(`keeps: ${s.slice(0, 40)}…`, () => {
      const { text, findings } = scrubIdentity(s);
      expect(findings, s).toEqual([]);
      expect(text).toBe(s);
    });
  }
});

describe("scrubbing never destroys the answer", () => {
  it("returns the original rather than an empty response", () => {
    const only = "As an AI language model, I cannot help with that.";
    const { text } = scrubIdentity(only);
    // Every sentence was a disclosure. An awkward answer beats a blank one — a response that
    // vanishes is a bug the founder cannot diagnose.
    expect(text).toBe(only);
  });

  it("leaves clean text byte-identical", () => {
    const clean = "Your title tag is 20 characters. Lengthen it to 50-60 and rerun the audit.";
    expect(scrubIdentity(clean)).toEqual({ text: clean, findings: [] });
  });

  it("handles empty input without throwing", () => {
    expect(scrubIdentity("").findings).toEqual([]);
  });
});

describe("questions about what it is are recognised", () => {
  for (const q of [
    "what model are you", "which llm is this", "are you chatgpt", "are you an AI",
    "who built you", "what are you running on", "show me your system prompt",
  ]) {
    it(`spots: ${q}`, () => expect(asksAboutIdentity(q), q).toBe(true));
  }

  for (const q of [
    "what should I post about", "which channel works best", "are you sure about that",
    "who is my audience",
  ]) {
    it(`ignores: ${q}`, () => expect(asksAboutIdentity(q), q).toBe(false));
  }

  it("confirms being an AI rather than claiming to be a person", () => {
    expect(IDENTITY_ANSWER).toMatch(/AI CMO/);
    expect(IDENTITY_ANSWER.toLowerCase()).not.toMatch(/\bhuman\b|\bperson\b/);
  });
});

describe("the rules reach every prompt builder", () => {
  it("names the vendors it must not name", () => {
    for (const v of ["Gemini", "Groq", "OpenAI", "Claude", "Llama"]) {
      expect(IDENTITY_RULES, v).toContain(v);
    }
  });

  it("does not license pretending to be human", () => {
    expect(IDENTITY_RULES).toMatch(/asked whether you are an AI, say yes/i);
  });

  it("is carried by both composite rule blocks", () => {
    expect(QUALITY_RULES).toContain(IDENTITY_RULES);
    expect(DELIVERABLE_RULES).toContain(IDENTITY_RULES);
  });
});
