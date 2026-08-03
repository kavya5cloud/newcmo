import { describe, expect, it } from "vitest";
import { CANONICAL_HOST, DISALLOWED, PUBLIC_ROUTES, SITE_DESCRIPTION, SITE_URL, url } from "@/lib/seo";
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

  it("leads with the home page, spelled the same way its canonical is", () => {
    // Search Console reported a duplicate because the sitemap said ".../" while the page's
    // own canonical said "..." — same page, two strings.
    expect(entries[0].url).toBe(SITE_URL);
    expect(entries[0].url.endsWith("/")).toBe(false);
    expect(entries[0].priority).toBe(1);
  });

  it("excludes the signed-in product and the admin screens", () => {
    const paths = entries.map((e) => e.url);
    for (const p of ["/app", "/studio", "/account", "/early-access/admin"]) {
      expect(paths).not.toContain(url(p));
    }
  });
});

describe("per-page metadata", () => {
  // Titles and descriptions are what a search result shows. Two pages sharing either is the
  // state this site was actually in — every page inherited the root title — so it is worth
  // asserting rather than eyeballing.
  async function collect() {
    const [root, ea, worked, privacy, terms] = await Promise.all([
      import("@/app/layout"),
      import("@/app/early-access/layout"),
      import("@/app/worked/layout"),
      import("@/app/privacy/page"),
      import("@/app/terms/page"),
    ]);
    const title = (m: { title?: unknown }) =>
      typeof m.title === "string" ? m.title : String((m.title as { default?: string })?.default ?? "");
    return [
      { path: "/", title: title(root.metadata), meta: root.metadata },
      { path: "/early-access", title: title(ea.metadata), meta: ea.metadata },
      { path: "/worked", title: title(worked.metadata), meta: worked.metadata },
      { path: "/privacy", title: title(privacy.metadata), meta: privacy.metadata },
      { path: "/terms", title: title(terms.metadata), meta: terms.metadata },
    ];
  }

  it("covers every route in the sitemap", async () => {
    const pages = await collect();
    expect(pages.map((p) => p.path).sort()).toEqual(PUBLIC_ROUTES.map((r) => r.path).sort());
  });

  it("gives every page a unique title", async () => {
    const titles = (await collect()).map((p) => p.title);
    expect(titles.every((t) => t.length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gives every page a unique description", async () => {
    const descs = (await collect()).map((p) => String(p.meta.description ?? ""));
    expect(descs.every((d) => d.length > 0)).toBe(true);
    expect(new Set(descs).size).toBe(descs.length);
  });

  it("gives every page a canonical pointing at itself", async () => {
    for (const p of await collect()) {
      expect(p.meta.alternates?.canonical).toBe(p.path);
    }
  });

  it("does not repeat the brand, which the title template already appends", async () => {
    // "Privacy Policy — Populr" + template = "Privacy Policy — Populr — Populr".
    for (const p of await collect()) {
      if (p.path === "/") continue;   // the root default is a full title, not a template arg
      expect(p.title).not.toMatch(/Populr/);
    }
  });
});

describe("canonical host", () => {
  it("is non-www", () => {
    expect(CANONICAL_HOST).toBe("https://trypopulr.in");
    expect(CANONICAL_HOST).not.toContain("www.");
  });

  // Regression guard for a real outage. A www -> non-www redirect used to live in
  // next.config.ts while Vercel's primary domain redirected non-www -> www. The two pointed
  // at each other and every URL on the site bounced until the browser gave up.
  //
  // Host and protocol redirects belong to the platform, which sees the request first and is
  // the only place that knows the whole domain setup. The app must not have an opinion.
  it("does not redirect on host or protocol from the app", async () => {
    const { default: config } = await import("../next.config");
    const redirects = await config.redirects!();
    for (const r of redirects) {
      for (const h of r.has ?? []) {
        expect(h.type, `redirect on ${r.source} matches host — that is the platform's job`).not.toBe("host");
        expect(h.key, `redirect on ${r.source} matches protocol — that is the platform's job`).not.toBe("x-forwarded-proto");
      }
      // Nothing here should send traffic to another origin either.
      expect(r.destination.startsWith("http")).toBe(false);
    }
  });

  it("still redirects the legacy content paths", async () => {
    const { default: config } = await import("../next.config");
    const redirects = await config.redirects!();
    const sources = redirects.map((r) => r.source);
    expect(sources).toContain("/privacy-policy");
    expect(sources).toContain("/terms-of-service");
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
