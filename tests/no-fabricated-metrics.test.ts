import { describe, expect, it } from "vitest";
import { AGENTS } from "@/app/app/_lib/catalog";

// The product tells a model never to invent a statistic. It should hold itself to the same
// rule — arguably a stricter one, because a model can be instructed to stop and a hardcoded
// string cannot.
//
// These items are the last-resort fallback on the agent board: they render when there is no
// generated feed and no profile-derived one, which is exactly what a first-time visitor
// sees. Four of them used to report findings that nothing had measured —
// "12 pages missing meta descriptions", "Keyword gap: marketing copilot — 2.1k/mo",
// "Perplexity cites 2 competitors for your core query". The same numbers went to every
// visitor regardless of their site.

const lines = AGENTS.flatMap((a) => [a.sum, ...a.items.map(([label]) => label)]);

describe("the default board reports nothing it has not measured", () => {
  it("states no counts of the visitor's own pages, threads or competitors", () => {
    // "12 pages missing meta descriptions" on a three-page site is a lie with a number in it.
    for (const line of lines) {
      expect(line, `"${line}" claims a count`).not.toMatch(
        /\b\d+\s*(pages?|competitors?|threads?|posts?|results?|citations?|keywords?|errors?|issues?)\b/i,
      );
    }
  });

  it("quotes no search volumes or difficulty scores", () => {
    for (const line of lines) {
      expect(line, `"${line}" quotes a metric`).not.toMatch(/\d[\d,.]*\s*(k|m)?\s*\/\s*mo|\bvolume\b|\bdifficulty\b/i);
    }
  });

  it("claims no result from a check that does not exist", () => {
    // Nothing in the codebase queries ChatGPT or Perplexity. Until something does, the board
    // may offer to look — it may not report what it found.
    for (const line of lines) {
      expect(line, `"${line}" reports a citation result`).not.toMatch(
        /\b(not cited|cites|ranked|ranks|is cited|appears in)\b/i,
      );
    }
  });

  it("still gives every agent something concrete to do", () => {
    // The honest version must not become empty. Removing a false claim is only an
    // improvement if what replaces it is still worth reading.
    for (const a of AGENTS) {
      expect(a.items.length, `${a.id} has no items`).toBeGreaterThan(0);
      for (const [label, action] of a.items) {
        expect(label.trim().length).toBeGreaterThan(12);
        expect(action.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
