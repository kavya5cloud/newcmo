import type { SocialPlatform } from "./types";

// Per-platform OAuth *app* credentials — the developer-app identity, not a user's token.
// User tokens live encrypted in social_credentials; these identify Populr to the provider.
//
// Absent credentials are a normal state, not an error. A platform without them stays on the
// reference adapter, which is what every environment does today: local, CI, and production
// until a developer app is approved. Nothing here throws, so a half-configured environment
// runs the same as an unconfigured one.

export type AppCredential = {
  clientId: string;
  clientSecret: string;
};

/**
 * Env var names per platform. Only LinkedIn and X are wired to live adapters so far; the
 * rest resolve to null and stay on the reference adapter.
 */
const ENV_KEYS: Partial<Record<SocialPlatform, { id: string; secret: string }>> = {
  linkedin: { id: "LINKEDIN_CLIENT_ID", secret: "LINKEDIN_CLIENT_SECRET" },
  // Not X_CLIENT_ID: that name is already taken by "sign in with X" in
  // app/api/auth/providers/route.ts. Sharing it would mean configuring social login
  // silently switched publishing to live — with login scopes that have no tweet.write, so
  // every post would 403. Publishing gets its own name so each is turned on deliberately.
  // The same X developer app can supply both values; that is then a choice, not an accident.
  x: { id: "X_PUBLISH_CLIENT_ID", secret: "X_PUBLISH_CLIENT_SECRET" },
};

export function appCredential(platform: SocialPlatform): AppCredential | null {
  const keys = ENV_KEYS[platform];
  if (!keys) return null;
  const clientId = process.env[keys.id]?.trim();
  const clientSecret = process.env[keys.secret]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** True when this platform will talk to the real provider rather than the reference stub. */
export function isLive(platform: SocialPlatform): boolean {
  return appCredential(platform) != null;
}

/** Every platform currently talking to a real provider. Used to label the UI honestly. */
export function livePlatforms(): SocialPlatform[] {
  return (Object.keys(ENV_KEYS) as SocialPlatform[]).filter(isLive);
}

/**
 * Where the provider sends the user back. Must match the redirect URI registered in the
 * developer app *exactly* — providers compare it as a string, not as a URL.
 */
export function redirectUri(platform: SocialPlatform, requestOrigin?: string): string {
  // Prefer the origin the request actually arrived on.
  //
  // Providers compare redirect_uri as an exact string, and they do not follow redirects to
  // reach it. A static value is wrong the moment the site is reachable on more than one
  // host — trypopulr.in serves a 308 to www.trypopulr.in, so a URI built from the non-www
  // APP_URL points at a redirect, and the flow dies with redirect_uri_mismatch.
  //
  // Using the live origin also guarantees the callback lands on the same host that started
  // the flow, which is what makes the state cookie readable when it gets there.
  //
  // SOCIAL_REDIRECT_BASE still wins when set, for the case where the public URL differs
  // from what the app sees (a proxy, or a preview deployment that must use the prod URI).
  const base = (process.env.SOCIAL_REDIRECT_BASE || requestOrigin || process.env.APP_URL || "")
    .replace(/\/+$/, "");
  return `${base}/api/social/oauth/${platform}/callback`;
}
