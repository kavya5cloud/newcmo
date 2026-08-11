import { describe, expect, it } from "vitest";
import { GUIDES, allGuides, guideBySlug } from "@/lib/guides";
import { CANONICAL_HOST, PUBLIC_ROUTES, url } from "@/lib/seo";

// The site had five indexable URLs, two of which were legal pages. The technical SEO was
// already correct and had nothing to rank — a search engine cannot send traffic to pages
// that do not exist. These assert the new pages stay indexable and stay honest.

describe("the canonical host matches what the domain serves", () => {
  it("is www, because that is what Vercel serves and non-www 308s to it", () => {
    // This said non-www for weeks. It did no damage only because APP_URL overrode it in
    // production — a default that is correct only when something else replaces it is not a
    // default, and clearing that variable would have pointed every canonical at a host that
    // redirects away.
    expect(CANONICAL_HOST).toBe("https://www.trypopulr.in");
  });

  it("builds urls without a double slash", () => {
    expect(url("/guides")).toBe("https://www.trypopulr.in/guides");
  });
});

describe("every guide is fit to index", () => {
  for (const g of GUIDES) {
    it(`${g.slug}: title is short enough to survive the results page`, () => {
      // Google truncates around 60; the brand suffix is appended by the layout.
      expect(g.title.length).toBeLessThanOrEqual(60);
    });

    it(`${g.slug}: description is a usable snippet`, () => {
      expect(g.description.length).toBeGreaterThanOrEqual(110);
      expect(g.description.length).toBeLessThanOrEqual(175);
    });

    it(`${g.slug}: has enough body to be worth ranking`, () => {
      const words = g.blocks
        .flatMap((b) =>
          b.kind === "ul" || b.kind === "ol" ? b.items
          : b.kind === "table" ? [...b.head, ...b.rows.flat()]
          : [b.text])
        .join(" ").split(/\s+/).length;
      // Thin pages do not rank and are a liability. This is a floor, not a target.
      expect(words, `${g.slug} has ${words} words`).toBeGreaterThan(500);
    });

    it(`${g.slug}: opens with prose, not a heading`, () => {
      expect(g.blocks[0]?.kind).toBe("p");
    });
  }

  it("has no duplicate slugs or titles", () => {
    expect(new Set(GUIDES.map((g) => g.slug)).size).toBe(GUIDES.length);
    expect(new Set(GUIDES.map((g) => g.title)).size).toBe(GUIDES.length);
  });

  it("resolves a slug, and refuses one that does not exist", () => {
    expect(guideBySlug(GUIDES[0].slug)?.title).toBe(GUIDES[0].title);
    expect(guideBySlug("does-not-exist")).toBeUndefined();
  });

  it("orders newest first", () => {
    const dates = allGuides().map((g) => g.published);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });
});

describe("FAQ markup describes questions the page actually answers", () => {
  // FAQPage structured data for questions a visitor cannot see is what earns a manual
  // action, not a rich result. The page renders every entry; these keep them real.
  for (const g of GUIDES.filter((g) => g.faq?.length)) {
    it(`${g.slug}: questions are questions and answers are substantial`, () => {
      for (const f of g.faq!) {
        expect(f.q.endsWith("?"), `"${f.q}" is not a question`).toBe(true);
        expect(f.a.length).toBeGreaterThan(80);
      }
    });
  }
});

describe("the guides are reachable", () => {
  it("the index is in the sitemap, so the hub is crawlable", () => {
    expect(PUBLIC_ROUTES.some((r) => r.path === "/guides")).toBe(true);
  });
});
