// One place that knows the site's public identity.
//
// Canonical URLs, the sitemap, robots and structured data all have to agree. When they are
// written separately they drift, and a canonical pointing at a host the sitemap does not
// list is worse than having neither.

/**
 * The canonical origin, no trailing slash.
 *
 * www and non-www serving the same content is duplicate content unless one redirects to the
 * other. This picks one; the DNS/host side has to redirect the other to match.
 */
export const SITE_URL = (process.env.APP_URL || "https://www.trypopulr.in").replace(/\/+$/, "");

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

/** Paths crawlers should not spend budget on, and should not surface. */
export const DISALLOWED = ["/api/", "/app/", "/app", "/studio/", "/studio", "/account", "/early-access/admin"];
