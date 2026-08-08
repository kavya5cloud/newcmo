import { describe, expect, it } from "vitest";
import { routeIntent } from "@/lib/services/intent-router";
import { buildContentPrompt } from "@/lib/services/content-engine";
import { buildEditPrompt } from "@/lib/services/editor-engine";
import { renderCmoPrompt } from "@/lib/cmo/renderer";
import type { CmoContext } from "@/lib/services/cmo-context";
import type { DecisionArtifact, EvidencePack } from "@/lib/cmo/contracts";

const ctx: CmoContext = {
  business: { name: "Acme", oneLiner: "invoicing", url: "https://acme.test" },
  missions: [], channelRanking: [], whatWorked: [], dismissed: [], latestMetrics: null, recentAssets: [],
  signals: { hasProfile: true, missionCount: 0, scoredOutcomes: 0, approvedActions: 0, dismissedActions: 0, hasLiveMetrics: false },
};
const decision: DecisionArtifact = {
  status: "recommended", recommendation: "Do SEO.", rankedOptions: [], tradeoffs: [],
  evidenceIds: [], uncertainty: { level: "low", missing: [] }, nextAction: "Execute: SEO",
};
const evidence: EvidencePack = { business: [], goals: [], constraints: [], history: [], outcomes: [], channels: [], mission: [], campaign: [], creative: [] };

describe("a question is answered, not filled with a deliverable", () => {
  // The worst behaviour in the product: any question that merely mentioned a format matched
  // a bare asset noun, fell past every rule, and hit the "if (asset) → content" fallback.
  // The founder asked how long a LinkedIn post should be and received a LinkedIn post.

  const asks = [
    "how long should a LinkedIn post be?",
    "any tips for blog SEO?",
    "what's a good time to tweet",
    "is email still worth doing for us?",
    "how often do people post on reddit",
    "does a carousel work better than a single image?",
  ];

  for (const q of asks) {
    it(`answers instead of generating: "${q}"`, () => {
      expect(routeIntent(q).intent).not.toBe("content");
    });
  }
});

describe("a real content request still generates", () => {
  const orders: [string, string][] = [
    ["write me a LinkedIn post about pricing", "content"],
    ["draft a blog on invoicing", "content"],
    ["give me 5 hooks", "content"],
    ["can you write a tweet about our launch", "content"],   // a question in form, an order in substance
    ["create an email for the launch", "content"],
  ];

  for (const [q, intent] of orders) {
    it(`still routes to ${intent}: "${q}"`, () => {
      expect(routeIntent(q).intent).toBe(intent);
    });
  }
});

describe("every prompt path carries the honesty rules", () => {
  // These used to live only in the conversational renderer, so the posts a customer actually
  // published were the one place with no rule against inventing a statistic.

  const paths: [string, string][] = [
    ["content", buildContentPrompt(ctx, "blog", "write about invoicing")],
    ["edit", buildEditPrompt(ctx, "make it shorter", "some existing copy")],
    ["conversation", renderCmoPrompt({ context: ctx, decision, evidence, question: "where should I focus?", recentTurns: "" })],
  ];

  for (const [name, prompt] of paths) {
    it(`${name} forbids invented statistics`, () => {
      expect(prompt).toMatch(/never invent a statistic/i);
      expect(prompt).toMatch(/2\.5x/);
    });

    it(`${name} forbids invented customers and quotes`, () => {
      expect(prompt).toMatch(/never invent a customer|testimonial/i);
    });
  }

  it("stops the conversational path from giving advice true of anyone", () => {
    const p = renderCmoPrompt({ context: ctx, decision, evidence, question: "how do I grow in Europe?", recentTurns: "" });
    expect(p).toMatch(/true for any business/i);
    expect(p).toMatch(/continent is not an audience/i);
  });

  it("keeps the deliverable path free of clarifying questions", () => {
    // A post cannot stop half way through to ask which country. It has to commit.
    const p = buildContentPrompt(ctx, "linkedin_post", "post about pricing");
    expect(p).not.toMatch(/ask which countries/i);
  });
});
