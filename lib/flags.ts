// Public-facing feature flags.
//
// These gate what the *marketing site* advertises, not what the product can do. Hiding a
// flag here never disables an engine or removes a route — signed-in users keep everything
// they had, and /studio/* still resolves. It only changes what we promise to someone who
// has not signed up yet, which is the thing worth being conservative about.
//
// NEXT_PUBLIC_* values are inlined at build time, so flipping one takes a redeploy rather
// than effect on the next request.

/** Read a public boolean env var. Anything other than "1"/"true" reads as off. */
function publicFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

/**
 * Whether the content engine exists for users at all.
 *
 * Off by default: the engine is still being finished. When off, the landing page stops
 * advertising it, the dashboard and Studio nav stop linking to it, and its routes redirect
 * away — so a bookmark or a guessed URL does not reach a half-finished surface. No code is
 * deleted and no data is touched. Set NEXT_PUBLIC_SHOW_CONTENT_ENGINE=1 to put it back.
 */
export const SHOW_CONTENT_ENGINE = publicFlag(process.env.NEXT_PUBLIC_SHOW_CONTENT_ENGINE, false);

/**
 * The authoring surface — where content is written and generated. This is the content
 * engine proper, and it is what gets sealed off.
 *
 * Deliberately a list rather than the whole /studio subtree. The Launch Workspace lives at
 * /studio/launch and is now the only primary call to action on the landing page; the
 * reporting pages (market, learning, jobs, integrations) and the publishing views
 * (social, publishing) describe work the Publishing Engine still does on a schedule.
 * Blocking /studio wholesale would take all of that down with it.
 */
export const CONTENT_ENGINE_PATHS = [
  "/studio",            // the composer home — exact match only, see isContentEnginePath
  "/studio/documents",
  "/studio/ads",
  "/studio/videos",
  "/studio/images",
  "/studio/motion",
  "/studio/ugc",
  "/studio/blitz",
  "/studio/library",
] as const;

/** Generation endpoints. Nothing server-side calls these over HTTP — the cron and the
 *  automation runner import the libraries directly — so sealing them affects only callers
 *  coming in from a browser. */
export const CONTENT_ENGINE_API_PATHS = [
  "/api/content/compose",
  "/api/content/refine",
  "/api/content/generate",
  "/api/content/edit",
  "/api/ugc",
] as const;

/** True when `pathname` belongs to the content engine and the flag is off. */
export function isContentEnginePath(pathname: string): boolean {
  if (SHOW_CONTENT_ENGINE) return false;
  // "/studio" is an exact match: "/studio/launch" must stay reachable.
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (CONTENT_ENGINE_PATHS as readonly string[]).includes(path);
}

/** True when `pathname` is a generation endpoint and the flag is off. */
export function isContentEngineApi(pathname: string): boolean {
  if (SHOW_CONTENT_ENGINE) return false;
  return (CONTENT_ENGINE_API_PATHS as readonly string[]).some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}
