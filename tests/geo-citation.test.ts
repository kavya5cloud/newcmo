import { describe, expect, it } from "vitest";
import { buyerQueries, queryIsFair } from "@/lib/geo/queries";
import { mentionsBrand, mentionContext, namedProducts, hostStem } from "@/lib/geo/detect";
import { summarize, reportToItems } from "@/lib/geo/check";
import { InMemoryCitationRepo } from "@/lib/geo/store";
import type { CitationReport } from "@/lib/geo/types";

// Measuring whether AI answers name you.
//
// The GEO agent used to ship hardcoded claims — "Perplexity cites 2 competitors for your
// core query" — for a check that did not exist. These assert the real one cannot drift back
// into flattering nonsense.

describe("the questions asked", () => {
  const facts = { category: "invoicing software", audience: "freelancers" };

  it("never names the brand in the question", () => {
    // The whole measurement rests on this. Ask "tell me about Acme" and the model describes
    // Acme whether or not it has ever heard of it — a dashboard that always says you win.
    for (const q of buyerQueries(facts)) {
      expect(queryIsFair(q, "Acme", "acme.com"), `"${q}" leaks the brand`).toBe(true);
    }
  });

  it("is stable, so a change in the result means a change in the world", () => {
    expect(buyerQueries(facts)).toEqual(buyerQueries(facts));
  });

  it("asks how a buyer asks, not how a marketer writes", () => {
    const qs = buyerQueries(facts).join(" ").toLowerCase();
    expect(qs).toContain("invoicing software");
    expect(qs).toContain("freelancers");
  });

  it("refuses to invent a question when there is no category", () => {
    // "What is the best ?" measures nothing. Better to check nothing than to check that.
    expect(buyerQueries({ category: "", audience: "freelancers" })).toEqual([]);
  });

  it("strips marketing language out of the category", () => {
    const qs = buyerQueries({ category: "The Best Revolutionary Invoicing", audience: "" }).join(" ");
    expect(qs.toLowerCase()).not.toContain("revolutionary");
    expect(qs.toLowerCase()).not.toContain("best revolutionary");
  });

  it("catches a brand that leaked into the category field", () => {
    expect(queryIsFair("What is the best Acme software?", "Acme", "acme.com")).toBe(false);
    expect(queryIsFair("best invoicing for acme.com users", "Acme", "acme.com")).toBe(false);
  });
});

describe("reading the answer", () => {
  it("finds the brand however it is punctuated", () => {
    expect(mentionsBrand("I'd suggest Populr for this.", "Populr", "trypopulr.in")).toBe(true);
    expect(mentionsBrand("Populr's approach is different.", "Populr", "trypopulr.in")).toBe(true);
    expect(mentionsBrand("Try trypopulr.in", "Populr", "trypopulr.in")).toBe(true);
  });

  it("does not claim a mention that is not there", () => {
    expect(mentionsBrand("Use HubSpot or Buffer.", "Populr", "trypopulr.in")).toBe(false);
  });

  it("keeps the sentence, so 'mentioned' can be checked rather than trusted", () => {
    // Being named dismissively is not being recommended, and a count cannot tell them apart.
    const answer = "Buffer is the usual pick. Populr is newer and less proven. Hootsuite is also common.";
    const ctx = mentionContext(answer, "Populr", "trypopulr.in");
    expect(ctx).toContain("Populr");
    expect(ctx).toContain("less proven");
  });

  it("reduces a host to its distinctive part", () => {
    expect(hostStem("https://www.get-acme.io/pricing")).toBe("getacme");
    expect(hostStem("acme.com")).toBe("acme");
  });
});

describe("the names that appeared", () => {
  const answer = `Here are some options:

1. **Buffer** — good for scheduling.
2. **Hootsuite** — more enterprise.
3. **Later** — strong on Instagram.

If you are just starting out, Buffer is the easiest.`;

  it("picks up the products the answer actually named", () => {
    const names = namedProducts(answer, { brand: "Populr", host: "trypopulr.in" });
    expect(names).toContain("Buffer");
    expect(names).toContain("Hootsuite");
  });

  it("never lists the brand as its own competitor", () => {
    const names = namedProducts("Populr and Buffer are options.", { brand: "Populr", host: "trypopulr.in" });
    expect(names).not.toContain("Populr");
    expect(names).toContain("Buffer");
  });

  it("does not mistake sentence openers for product names", () => {
    const names = namedProducts("However, you should consider cost. If budget matters, try Buffer.", { brand: "X", host: "x.com" });
    for (const junk of ["However", "If", "You", "The"]) expect(names).not.toContain(junk);
  });

  it("does not repeat a name", () => {
    const names = namedProducts(answer, { brand: "Populr", host: "trypopulr.in" });
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("what the dashboard is told", () => {
  const report = (mentioned: number, total: number): CitationReport => ({
    tenant: "t", brand: "Acme", host: "acme.com", engine: "gemini-3.6-flash", checkedAt: 1,
    checks: Array.from({ length: total }, (_, i) => ({
      query: `question ${i}`,
      outcome: i < mentioned ? "mentioned" as const : "absent" as const,
      named: i < mentioned ? [] : ["Buffer", "Hootsuite"],
      context: i < mentioned ? "Acme is a good option." : null,
      engine: "gemini-3.6-flash",
      checkedAt: 1,
    })),
  });

  it("states the real count, in both directions", () => {
    expect(summarize(report(0, 4))).toContain("Not named in any of 4");
    expect(summarize(report(4, 4))).toContain("all 4");
    expect(summarize(report(1, 4))).toContain("1 of 4");
  });

  it("names which engine answered, so it is never implied to be ChatGPT", () => {
    expect(report(0, 4).engine).toBe("gemini-3.6-flash");
  });

  it("gives the question and what came back, not a bare verdict", () => {
    const items = reportToItems(report(0, 2));
    expect(items[0][0]).toContain("question 0");
    expect(items[0][0]).toContain("Buffer");
  });

  it("says nothing about competitors it did not see", () => {
    const items = reportToItems(report(2, 2));
    for (const [label] of items) expect(label).not.toMatch(/Buffer|Hootsuite/);
  });
});

describe("history", () => {
  it("appends rather than overwrites, because the second run is the point", async () => {
    // One report says you are not named. A series says whether anything you did changed it.
    const repo = new InMemoryCitationRepo();
    const base = { tenant: "t", brand: "A", host: "a.com", engine: "e", checks: [] };
    await repo.save({ ...base, checkedAt: 1 });
    await repo.save({ ...base, checkedAt: 2 });
    expect((await repo.latest("t"))?.checkedAt).toBe(2);
    expect((await repo.history("t")).length).toBe(2);
  });

  it("keeps tenants apart", async () => {
    const repo = new InMemoryCitationRepo();
    await repo.save({ tenant: "a", brand: "A", host: "a.com", engine: "e", checkedAt: 1, checks: [] });
    expect(await repo.latest("b")).toBe(null);
  });
});
