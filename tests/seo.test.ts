import { describe, expect, it } from "vitest";
import { DISALLOWED, PUBLIC_ROUTES, SITE_DESCRIPTION, SITE_URL, url } from "@/lib/seo";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

// These guard the agreements that break quietly: a sitemap listing a route robots blocks,
// a canonical host that differs from the one in the sitemap, a description long enough to
// be truncated in a result. None of it fails a build — it just stops working.

describe("site identity", () => {
  it("has an absolute origin with no trailing slash", () => {
    expect(SITE_URL).toMatch(/^https:\/\//);
    expect(SITE_URL.endsWith("/")).toBe(false);
  });

  it("keeps the default description short enough not to be cut in a result", () => {
    // Google truncates around 155–160 characters.
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(50);
  });

  it("builds absolute urls without doubling or dropping the slash", () => {
    expect(url("/privacy")).toBe(`${SITE_URL}/privacy`);
    expect(url("privacy")).toBe(`${SITE_URL}/privacy`);
    expect(url("/")).toBe(`${SITE_URL}/`);
  });
});

describe("sitemap", () => {
  const entries = sitemap();

  it("lists every public route once", () => {
    expect(entries).toHaveLength(PUBLIC_ROUTES.length);
    expect(new Set(entries.map((e) => e.url)).size).toBe(entries.length);
  });

  it("uses absolute urls on the canonical host", () => {
    for (const e of entries) expect(e.url.startsWith(SITE_URL)).toBe(true);
  });

  it("does not list anything robots disallows", () => {
    // A sitemap that advertises a blocked URL is a contradiction; Search Console reports it
    // as an error and the URL is neither crawled nor trusted.
    for (const e of entries) {
      const path = e.url.slice(SITE_URL.length) || "/";
      for (const blocked of DISALLOWED) {
        expect(path === blocked || path.startsWith(blocked)).toBe(false);
      }
    }
  });

  it("leads with the home page", () => {
    expect(entries[0].url).toBe(url("/"));
    expect(entries[0].priority).toBe(1);
  });

  it("excludes the signed-in product and the admin screens", () => {
    const paths = entries.map((e) => e.url);
    for (const p of ["/app", "/studio", "/account", "/early-access/admin"]) {
      expect(paths).not.toContain(url(p));
    }
  });
});

describe("robots", () => {
  const r = robots();
  const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;

  it("points at the sitemap on the canonical host", () => {
    expect(r.sitemap).toBe(url("/sitemap.xml"));
  });

  it("allows the public site", () => {
    expect(rule.allow).toBe("/");
    expect(rule.userAgent).toBe("*");
  });

  it("blocks the API and every signed-in surface", () => {
    const disallow = rule.disallow as string[];
    for (const p of ["/api/", "/app", "/studio", "/account", "/early-access/admin"]) {
      expect(disallow).toContain(p);
    }
  });

  it("agrees with the host used for canonicals", () => {
    expect(r.host).toBe(SITE_URL);
  });
});
