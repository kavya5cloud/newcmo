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
 * Whether the landing page advertises the content engine as a way into the product.
 *
 * Off by default: the engine is still being finished, and "Create content" was the primary
 * call to action on the home page — the first thing a visitor was promised. Set
 * NEXT_PUBLIC_SHOW_CONTENT_ENGINE=1 to put it back.
 */
export const SHOW_CONTENT_ENGINE = publicFlag(process.env.NEXT_PUBLIC_SHOW_CONTENT_ENGINE, false);
