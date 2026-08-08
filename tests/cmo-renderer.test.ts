import { describe, it, expect } from "vitest";
import { renderCmoPrompt, sanitizeCmoText } from "@/lib/cmo/renderer";
import type { CmoContext } from "@/lib/services/cmo-context";
import type { DecisionArtifact, EvidencePack } from "@/lib/cmo/contracts";

const emptyEvidence: EvidencePack = { business: [], goals: [], constraints: [], history: [], outcomes: [], channels: [], mission: [], campaign: [], creative: [] };

const ctx = (name = "Populr"): CmoContext => ({
  business: { name, oneLiner: "AI CMO", url: "https://x.test" },
  missions: [], channelRanking: [], whatWorked: [], dismissed: [], latestMetrics: null, recentAssets: [],
  signals: { hasProfile: true, missionCount: 0, scoredOutcomes: 0, approvedActions: 0, dismissedActions: 0, hasLiveMetrics: false },
});

const recommended: DecisionArtifact = {
  status: "recommended",
  recommendation: "Prioritize SEO before LinkedIn.",
  rankedOptions: [{ action: "Invest in SEO", score: 0.62, reason: "highest leverage" }],
  tradeoffs: ["pulls focus from LinkedIn"],
  evidenceIds: ["ev1", "ev2"],
  uncertainty: { level: "medium", missing: ["live Search Console data"] },
  nextAction: "Execute: Invest in SEO",
};

describe("sanitizeCmoText", () => {
  it("strips leading artifact labels but keeps the content", () => {
    const dump = "Decision: Focus on SEO\nTrade-off: less LinkedIn\nEvidence: you have content\nNext steps: fix technical SEO";
    const out = sanitizeCmoText(dump);
    expect(out).not.toMatch(/Decision:/i);
    expect(out).not.toMatch(/Trade-?off:/i);
    expect(out).not.toMatch(/Evidence:/i);
    expect(out).not.toMatch(/Next steps:/i);
    expect(out).toContain("Focus on SEO");
    expect(out).toContain("fix technical SEO");
  });

  it("strips markdown-wrapped artifact headers", () => {
    expect(sanitizeCmoText("**Recommendation:** ship it")).toBe("ship it");
    expect(sanitizeCmoText("- Confidence: high")).toBe("high");
  });

  it("removes internal evidence IDs and graph terminology", () => {
    const out = sanitizeCmoText("Based on ev12 and the BusinessGraph, and the evidence pack, do SEO.");
    expect(out).not.toMatch(/ev12/);
    expect(out).not.toMatch(/BusinessGraph/i);
    expect(out).not.toMatch(/evidence pack/i);
    expect(out).toContain("do SEO");
  });

  it("leaves ordinary CMO prose untouched", () => {
    const prose = "I'd focus on SEO before LinkedIn. Your content is worth ranking, but search visibility is underdeveloped. Start with technical SEO.";
    expect(sanitizeCmoText(prose)).toBe(prose);
  });

  it("collapses excess whitespace and trims", () => {
    expect(sanitizeCmoText("hello\n\n\n\nworld   ok")).toBe("hello\n\nworld ok");
  });
});

describe("renderCmoPrompt", () => {
  it("carries the CMO persona and the no-artifacts rules", () => {
    const p = renderCmoPrompt({ context: ctx(), decision: recommended, evidence: emptyEvidence, question: "what should I do?" });
    expect(p).toMatch(/AI CMO/);
    expect(p).toMatch(/VP Marketing/);
    expect(p).toMatch(/NEVER print labels/i);
    expect(p).toMatch(/never see/i);
  });

  it("passes the decision as advisory (only when asked for direction), never as a template", () => {
    const p = renderCmoPrompt({ context: ctx(), decision: recommended, evidence: emptyEvidence, question: "who are you?" });
    expect(p).toMatch(/If \(and only if\) the founder is asking what to do/i);
    expect(p).toMatch(/answer that directly as their CMO/i);
    // raw internal decision fields must not be injected as data
    expect(p).not.toContain("pulls focus from LinkedIn"); // decision.tradeoffs content
    expect(p).not.toMatch(/evidenceIds/); // internal field name
    expect(p).not.toContain('"status"'); // no serialized artifact
  });

  it("never leaks internal evidence IDs into the prompt", () => {
    const evidence: EvidencePack = { ...emptyEvidence, business: [{ id: "ev1", kind: "founder_stated", label: "Business", value: "Populr: AI CMO", source: "business_profiles", confidence: 0.9 }] };
    const p = renderCmoPrompt({ context: ctx(), decision: recommended, evidence, question: "help" });
    expect(p).toContain("Business: Populr: AI CMO"); // value shown
    expect(p).not.toMatch(/\bev1\b/); // id hidden
    expect(p).not.toMatch(/founder_stated/); // kind hidden
  });

  it("handles insufficient evidence with a warm, non-fabricating instruction", () => {
    const cold: DecisionArtifact = { ...recommended, status: "insufficient_evidence", recommendation: "Not enough yet.", rankedOptions: [] };
    const p = renderCmoPrompt({ context: ctx("Unknown"), decision: cold, evidence: emptyEvidence, question: "grow me" });
    expect(p).toMatch(/don't have enough grounding/i);
    expect(p).toMatch(/Do not invent specifics/i);
  });
});

describe("the prompt forbids the failure modes seen in real answers", () => {
  // A production answer about "boosting social media reach in Europe" opened with
  // "Europeans are 2.5x more likely to engage with content that's relevant to their
  // interests" — a number with no source, and circular besides: everyone engages more with
  // relevant content. It then advised translating content, using influencers, and posting at
  // good times, which is true of every business in every market.
  //
  // The invented figure is the serious one. A founder may put it in a deck, and there is no
  // source to give when someone asks.

  const prompt = renderCmoPrompt({
    context: ctx("Acme"),
    decision: recommended,
    evidence: emptyEvidence,
    question: "how do I boost social media reach in Europe?",
    recentTurns: "",
  });

  it("forbids inventing statistics", () => {
    expect(prompt).toMatch(/never invent a statistic/i);
  });

  it("names the shape of a fabricated number, not just the concept", () => {
    // A rule the model can pattern-match beats an abstract principle.
    expect(prompt).toMatch(/2\.5x|studies show/i);
  });

  it("requires advice that would not survive swapping the company out", () => {
    expect(prompt).toMatch(/true for any business|substitute a different/i);
  });

  it("refuses to treat a continent as an audience", () => {
    expect(prompt).toMatch(/continent is not an audience/i);
  });

  it("still forbids the padding and category-verb failures", () => {
    expect(prompt).toMatch(/do not pad/i);
    expect(prompt).toMatch(/categories, not actions/i);
  });
});
