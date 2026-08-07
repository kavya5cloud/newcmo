import { describe, expect, it } from "vitest";
import { renderCmoPrompt, sanitizeCmoText } from "@/lib/cmo/renderer";
import type { CmoContext } from "@/lib/services/cmo-context";
import type { DecisionArtifact, EvidencePack } from "@/lib/cmo/contracts";

// The CMO's answers read as vague and padded. The cause was not the model: the prompt itself
// contained the filler ("A sensible first move is to…") and lowercased the channel names, so
// the model repeated back exactly what it was handed. These pin the prompt's own words.

const context = { business: { name: "Acme" } } as unknown as CmoContext;
const evidence = {} as EvidencePack;

const decision = {
  status: "recommended",
  recommendation: "Prioritize SEO — freelancers search for invoicing tools before they ask anyone.",
  rankedOptions: [{ action: "Invest in SEO", score: 0.55, reason: "…" }],
  nextAction: "Execute: fix crawlability on the pricing page",
  uncertainty: { missing: [] },
} as unknown as DecisionArtifact;

const prompt = () => renderCmoPrompt({ context, decision, evidence, question: "What should we fix first?" });

describe("the prompt does not feed the model filler", () => {
  it("never hands it a phrase it will parrot back", () => {
    // Scoped to the guidance — everything before the rules. That half describes what to
    // say, so filler there gets repeated. The rules quote the same phrases deliberately,
    // in order to ban them, which is the opposite thing.
    const guidance = prompt().split("How you speak:")[0].toLowerCase();
    for (const filler of ["a sensible first move", "the way to go", "worth considering"]) {
      expect(guidance, `guidance contains "${filler}", which the model will repeat`).not.toContain(filler);
    }
  });

  it("still bans that filler in the rules, where saying it is the point", () => {
    const rules = prompt().split("How you speak:")[1].toLowerCase();
    expect(rules).toContain("a sensible first move");
    expect(rules).toContain("do not pad");
  });

  it("keeps channel names capitalised instead of lowercasing them back to ids", () => {
    // `.toLowerCase()` on the action turned "Invest in SEO" into "invest in seo" and undid
    // the naming fix one layer up.
    const p = prompt();
    expect(p).toContain("Invest in SEO");
    expect(p).not.toContain("invest in seo");
  });

  it("preserves the case of the next action too", () => {
    expect(prompt()).toContain("fix crawlability on the pricing page");
  });

  it("strips the internal 'Execute:' marker before the model sees it", () => {
    expect(prompt()).not.toContain("Execute:");
  });
});

describe("the prompt asks for something worth reading", () => {
  const p = () => prompt().toLowerCase();

  it("bans the vague verbs that made answers useless", () => {
    // Naming them is what stopped them; a general "be specific" did not.
    for (const vague of ["strengthen our online presence", "increase visibility", "optimise the funnel"]) {
      expect(p()).toContain(vague.split(" ").slice(-2).join(" "));
    }
  });

  it("forbids justifying a recommendation with its own ranking", () => {
    // "It scores well" is circular — the founder cannot check it.
    expect(p()).toContain("never justify a recommendation by saying it scores well");
  });

  it("requires answering the question that was asked", () => {
    expect(p()).toContain("answer the question actually asked");
  });

  it("sets a length that fits a conversation", () => {
    expect(p()).toContain("under 150 words");
  });
});

describe("nothing internal reaches the founder", () => {
  it("strips artifact labels and ids if the model leaks them", () => {
    const leaked = "Decision: ship it\nEvidence: ev12 says so\nBusinessGraph version 4";
    const clean = sanitizeCmoText(leaked);
    expect(clean).not.toMatch(/^Decision:/m);
    expect(clean).not.toContain("ev12");
    expect(clean).not.toContain("BusinessGraph");
    expect(clean).toContain("ship it");   // the real content survives
  });
});
