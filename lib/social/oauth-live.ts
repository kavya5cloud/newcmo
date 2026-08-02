import { createHash, randomBytes } from "node:crypto";
import { appCredential, redirectUri } from "./app-credentials";
import { describeError, request } from "./http";
import type { OAuthToken, SocialPlatform } from "./types";

// Real OAuth for LinkedIn and X.
//
// Deliberately separate from OAuthService, which stays as the reference flow. Platforms
// without app credentials keep using it, so this file only ever runs for a platform that
// has been configured — no environment is forced to have both.
//
// The two providers differ in ways that matter:
//   - X requires PKCE, so a code_verifier has to survive the round trip to the browser and
//     back. The caller owns that storage (a signed, httpOnly cookie in the route).
//   - LinkedIn identifies the member through OpenID `sub`; X uses its own users/me.

/** Scopes actually needed to post. Asking for more gets apps rejected in review. */
const LIVE_SCOPES: Partial<Record<SocialPlatform, string[]>> = {
  linkedin: ["openid", "profile", "w_member_social"],
  x: ["tweet.read", "tweet.write", "users.read", "offline.access"],
};

export function liveScopes(platform: SocialPlatform): string[] {
  return LIVE_SCOPES[platform] ?? [];
}

/** True when this platform's live OAuth flow is implemented (not merely configured). */
export function supportsLiveOAuth(platform: SocialPlatform): boolean {
  return platform === "linkedin" || platform === "x";
}

// ---- PKCE ----

export type Pkce = { verifier: string; challenge: string };

/** RFC 7636 S256. The verifier is the secret; only the challenge goes in the URL. */
export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** An unguessable value tying the callback back to the browser that started the flow. */
export function createState(): string {
  return randomBytes(16).toString("base64url");
}

// ---- Step 1: consent URL ----

export function buildAuthUrl(
  platform: SocialPlatform,
  state: string,
  pkce?: Pkce,
  requestOrigin?: string,
): { authUrl: string; scopes: string[]; redirectUri: string } | { error: string } {
  const app = appCredential(platform);
  if (!app) return { error: `${platform} has no app credentials configured` };
  const scopes = liveScopes(platform);
  const uri = redirectUri(platform, requestOrigin);
  if (!uri.startsWith("http")) {
    return { error: "No public origin is known, so the callback URL would be relative" };
  }

  if (platform === "linkedin") {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: app.clientId,
      redirect_uri: uri,
      state,
      scope: scopes.join(" "),
    });
    return { authUrl: `https://www.linkedin.com/oauth/v2/authorization?${q}`, scopes, redirectUri: uri };
  }

  if (platform === "x") {
    if (!pkce) return { error: "X requires PKCE — no code challenge was generated" };
    const q = new URLSearchParams({
      response_type: "code",
      client_id: app.clientId,
      redirect_uri: uri,
      state,
      scope: scopes.join(" "),
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
    });
    return { authUrl: `https://twitter.com/i/oauth2/authorize?${q}`, scopes, redirectUri: uri };
  }

  return { error: `${platform} has no live OAuth flow` };
}

// ---- Step 2: code → token ----

type Exchange = { ok: true; token: OAuthToken } | { ok: false; error: string };

/**
 * `uri` must be byte-identical to the redirect_uri sent at the start of the flow — every
 * provider re-validates it at exchange time. It is passed in rather than rebuilt so the two
 * cannot disagree if the host or config changes mid-flow.
 */
export async function exchangeCode(
  platform: SocialPlatform,
  code: string,
  verifier: string | null,
  uri: string,
  now: () => number = Date.now,
): Promise<Exchange> {
  const app = appCredential(platform);
  if (!app) return { ok: false, error: `${platform} has no app credentials configured` };

  if (platform === "linkedin") {
    const res = await request("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: uri,
        client_id: app.clientId,
        client_secret: app.clientSecret,
      }).toString(),
    });
    if (!res.ok) return { ok: false, error: describeError(res) };

    const b = res.body as Record<string, unknown>;
    const accessToken = typeof b?.access_token === "string" ? b.access_token : "";
    if (!accessToken) return { ok: false, error: "LinkedIn returned no access token" };

    // The member id (`sub`) is required to build urn:li:person:… when posting. Without it
    // the connection would look fine and every publish would fail, so this is fatal here.
    const who = await request("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!who.ok) return { ok: false, error: `connected, but LinkedIn would not identify the member: ${describeError(who)}` };
    const profile = who.body as Record<string, unknown>;
    const sub = typeof profile?.sub === "string" ? profile.sub : "";
    if (!sub) return { ok: false, error: "LinkedIn returned no member id" };

    const expiresIn = typeof b.expires_in === "number" ? b.expires_in : null;
    return {
      ok: true,
      token: {
        accessToken,
        refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : "",
        expiresAt: expiresIn != null ? now() + expiresIn * 1000 : null,
        scopes: liveScopes(platform),
        externalId: sub,
        handle: typeof profile.name === "string" && profile.name ? profile.name : "LinkedIn member",
      },
    };
  }

  if (platform === "x") {
    if (!verifier) return { ok: false, error: "the PKCE verifier was missing — restart the connection" };
    const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64");
    const res = await request("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: uri,
        client_id: app.clientId,
        code_verifier: verifier,
      }).toString(),
    });
    if (!res.ok) return { ok: false, error: describeError(res) };

    const b = res.body as Record<string, unknown>;
    const accessToken = typeof b?.access_token === "string" ? b.access_token : "";
    if (!accessToken) return { ok: false, error: "X returned no access token" };

    const who = await request("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!who.ok) return { ok: false, error: `connected, but X would not identify the account: ${describeError(who)}` };
    const data = (who.body as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    const id = data && typeof data.id === "string" ? data.id : "";
    if (!id) return { ok: false, error: "X returned no account id" };

    const expiresIn = typeof b.expires_in === "number" ? b.expires_in : null;
    return {
      ok: true,
      token: {
        accessToken,
        refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : "",
        expiresAt: expiresIn != null ? now() + expiresIn * 1000 : null,
        scopes: liveScopes(platform),
        externalId: id,
        handle: data && typeof data.username === "string" ? `@${data.username}` : "@x_account",
      },
    };
  }

  return { ok: false, error: `${platform} has no live OAuth flow` };
}
