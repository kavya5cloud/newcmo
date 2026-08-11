// One place that knows the site's public identity.
//
// Canonical URLs, the sitemap, robots and structured data all have to agree. When they are
// written separately they drift, and a canonical pointing at a host the sitemap does not
// list is worse than having neither.

/**
 * The canonical origin, no trailing slash. **www is the chosen host.**
 *
 * This said non-www for weeks while Vercel served www and redirected non-www to it. It did
 * no visible damage only because APP_URL is set in production and overrides it — so the
 * fallback was wrong and silent, waiting for the day someone cleared that variable. On that
 * day every canonical on the site would have pointed at a host that 308s away, which is the
 * single most effective way to tell Google your pages are duplicates of somewhere else.
 *
 * A default that is only correct because something else overrides it is not a default.
 * It now matches what the domain actually serves.
 *
 * www and non-www serving the same content is duplicate content, so one must redirect to the
 * other. That redirect lives in Vercel's domain settings, not in this app — see
 * NON_CANONICAL_HOST. Everything that emits a URL reads this constant.
 */
export const CANONICAL_HOST = "https://www.trypopulr.in";

/**
 * The non-canonical form. Reference only — nothing in the app redirects on it.
 *
 * Enforcing the canonical host is Vercel's job. When it was also enforced here the two
 * pointed in opposite directions and every URL on the site became a redirect loop.
 */
export const NON_CANONICAL_HOST = "trypopulr.in";

/** @deprecated Kept so existing imports keep compiling; prefer NON_CANONICAL_HOST. */
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
  { path: "/guides", priority: 0.9, changeFrequency: "weekly" },
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
  // Personal invitation links — one per user, none of them useful in a search result. The
  // page also carries noindex, which is what actually keeps it out if someone links to it.
  "/join/", "/join",
];
