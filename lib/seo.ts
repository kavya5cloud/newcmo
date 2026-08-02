// One place that knows the site's public identity.
//
// Canonical URLs, the sitemap, robots and structured data all have to agree. When they are
// written separately they drift, and a canonical pointing at a host the sitemap does not
// list is worse than having neither.

/**
 * The canonical origin, no trailing slash. Non-www is the chosen host.
 *
 * www and non-www serving the same content is duplicate content, so www redirects here
 * (301, in next.config.ts) rather than both answering. Everything that emits a URL —
 * canonicals, sitemap, robots, structured data, OG tags — reads this, so there is one
 * place to change if the decision ever reverses.
 */
export const CANONICAL_HOST = "https://trypopulr.in";

/** The www form, which must redirect to CANONICAL_HOST rather than serve. */
export const WWW_HOST = "www.trypopulr.in";

export const SITE_URL = (process.env.APP_URL || CANONICAL_HOST).replace(/\/+$/, "");

export const SITE_NAME = "Populr";

/** Used where no page-specific description exists. Kept under ~155 chars so it is not cut. */
export const SITE_DESCRIPTION =
  "Populr is your AI CMO. It reads your site, runs SEO, AI-search visibility, Reddit and content daily, and sends you only what is worth approving.";

export const url = (path = "/") => `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * Public, indexable routes.
 *
 * Everything under /app, /studio, /api, /account and /early-access/admin is deliberately
 * absent: it is either signed-in product surface or an admin screen, and none of it is
 * useful in a search result.
 */
export const PUBLIC_ROUTES: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/early-access", priority: 0.8, changeFrequency: "weekly" },
  { path: "/worked", priority: 0.6, changeFrequency: "weekly" },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

/**
 * Paths crawlers should not spend budget on, and should not surface.
 *
 * /auth and /dashboard have no routes today. They are listed anyway: if either is ever
 * added it will be signed-in surface, and a robots rule that predates the route is free
 * insurance against it being crawled the day it ships.
 */
export const DISALLOWED = [
  "/api/",
  "/app/", "/app",
  "/studio/", "/studio",
  "/auth/", "/auth",
  "/dashboard/", "/dashboard",
  "/account",
  "/early-access/admin",
];
