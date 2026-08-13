import { describe, expect, it } from "vitest";
import { normalizeProfile } from "@/app/app/_lib/catalog";

// The Competitors panel and the company overview rendered blank with no error anywhere:
// the analysis reported success and the panel was simply empty, which is the hardest kind
// of failure to notice because nothing looks broken.
//
// Two causes. Both fields came back in one JSON object alongside a four-sentence
// description, so a truncated response lost all of them at once — fixed by splitting the
// call. And nothing checked the shape of what came back.

describe("a profile is safe to render whatever the model returned", () => {
  it("accepts the normal case unchanged", () => {
    const p = normalizeProfile({ name: "Acme", competitors: ["Stripe", "Adyen"] });
    expect(p.competitors).toEqual(["Stripe", "Adyen"]);
  });

  it("survives a missing competitors field", () => {
    expect(normalizeProfile({ name: "Acme" } as Record<string, unknown>).competitors).toEqual([]);
  });

  it("splits a comma-separated string, which models return often enough to matter", () => {
    const p = normalizeProfile({ competitors: "Stripe, Adyen; Braintree" });
    expect(p.competitors).toEqual(["Stripe", "Adyen", "Braintree"]);
  });

  it("drops the prompt's own placeholder coming back as the answer", () => {
    // The prompt asks for "3-4 names". Sometimes that is what arrives.
    const p = normalizeProfile({ competitors: ["3-4 names", "Stripe", "N/A", "unknown"] });
    expect(p.competitors).toEqual(["Stripe"]);
  });

  it("strips quotes and stray punctuation", () => {
    const p = normalizeProfile({ competitors: ['"Stripe"', " - Adyen ", "Braintree."] });
    expect(p.competitors).toEqual(["Stripe", "Adyen", "Braintree"]);
  });

  it("caps the list so one runaway answer cannot flood the panel", () => {
    const p = normalizeProfile({ competitors: ["A1", "B2", "C3", "D4", "E5", "F6"] });
    expect((p.competitors as string[]).length).toBe(4);
  });

  it("joins an array of adjectives instead of throwing it away", () => {
    // Asked for "3 adjectives for brand voice", the model returns an array about half the
    // time. That is the right answer in the wrong container — deleting it left voice
    // undefined everywhere downstream, which is a silent downgrade of a working response.
    const p = normalizeProfile({ voice: ["Precise", "Modern", "Sophisticated"] });
    expect(p.voice).toBe("Precise, Modern, Sophisticated");
  });

  it("stringifies a number that should have been text", () => {
    expect(normalizeProfile({ name: 2026 }).name).toBe("2026");
  });

  it("removes text fields that came back as the wrong type", () => {
    // Rendering an object into a <p> is a blank panel or a crash, never useful.
    const p = normalizeProfile({ name: "Acme", description: { text: "hi" }, positioning: null });
    expect(p.description).toBeUndefined();
    expect(p.positioning).toBeUndefined();
    expect(p.name).toBe("Acme");
  });

  it("fills in structure, never content", () => {
    // It must not invent a competitor to make the panel look populated.
    const p = normalizeProfile({ name: "Acme", competitors: [] });
    expect(p.competitors).toEqual([]);
  });
});
