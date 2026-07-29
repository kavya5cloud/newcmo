import { CONSTRAINTS } from "./adapters";
import { describeError, isRetryable, redact, request } from "./http";
import type {
  ConnectionCheck, OAuthToken, PlatformConstraints, PublishRequest, PublishResult,
  SocialAdapter, SocialPlatform,
} from "./types";
import { appCredential } from "./app-credentials";

// Live adapters for LinkedIn and X.
//
// These implement exactly the same SocialAdapter interface as the reference ones, so the
// scheduler, queue and workers are unchanged — they only ever talk to the interface.
//
// Neither platform offers server-side scheduling on these endpoints, so `schedule` does not
// pretend to. It reports that Populr dispatches at the requested time, which is true: the
// queue holds the job and calls `publish` when it comes due. Claiming native scheduling
// would silently drop the time.
//
// Text limits are NOT re-checked here beyond the shared constraint check — the composer and
// pre-publish pipeline already fit text to the platform, and duplicating the rule in two
// places is how the two drift apart.

const LINKEDIN_VERSION = "202401";

/** Shared constraint validation. Adapter owns platform rules; this is the same check the
 *  reference adapter runs, so behaviour does not change when a platform goes live. */
function checkConstraints(platform: SocialPlatform, req: PublishRequest): string | null {
  const c = CONSTRAINTS[platform];
  if (!req.content.text.trim() && req.assets.length === 0) return "nothing to post";
  if (req.content.text.length > c.maxText) return `text exceeds ${c.maxText} chars`;
  if (req.assets.length > c.maxAssets) return `too many assets (max ${c.maxAssets})`;
  if (c.requiresAsset && req.assets.length === 0) return "at least one media asset is required";
  if (!c.allowsVideo && req.assets.some((a) => a.kind === "video")) return "video is not supported";
  return null;
}

/** A failed provider call, shaped so the queue can tell "try again" from "this will never
 *  work". The retryable marker is carried in the message because PublishResult has no field
 *  for it and inventing one would ripple through every stored job. */
function failure(platform: SocialPlatform, at: number, detail: string, retryable: boolean): PublishResult {
  return { ok: false, platform, error: retryable ? `${detail} (retryable)` : detail, at };
}

// ---------------------------------------------------------------- LinkedIn

/**
 * LinkedIn member posts via the Posts API.
 *
 * Media is deliberately not supported yet: images require a separate registerUpload →
 * binary PUT → attach dance, and a half-built version that silently drops the image is
 * worse than one that says it cannot. Text and link posts work.
 */
export class LinkedInAdapter implements SocialAdapter {
  readonly platform: SocialPlatform = "linkedin";
  constructor(private now: () => number = Date.now) {}

  constraints(): PlatformConstraints {
    // Media is not implemented, so advertise zero assets rather than LinkedIn's real 9.
    // The scheduler validates against this, which stops a post with an image from being
    // queued and failing at the last moment.
    return { platform: this.platform, ...CONSTRAINTS.linkedin, maxAssets: 0, allowsVideo: false };
  }

  private headers(token: OAuthToken): Record<string, string> {
    return {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": LINKEDIN_VERSION,
    };
  }

  async publish(req: PublishRequest, token: OAuthToken): Promise<PublishResult> {
    const at = this.now();
    const err = checkConstraints(this.platform, req);
    if (err) return failure(this.platform, at, err, false);
    if (!token.externalId) return failure(this.platform, at, "account is missing its LinkedIn member id — reconnect", false);

    const body = {
      author: `urn:li:person:${token.externalId}`,
      commentary: req.content.text,
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };

    const res = await request("https://api.linkedin.com/rest/posts", {
      method: "POST", headers: this.headers(token), body: JSON.stringify(body),
    });

    if (!res.ok) return failure(this.platform, at, describeError(res), isRetryable(res.status));

    // The created post's URN comes back in a header, not the body.
    const urn = res.headers?.get("x-restli-id")
      ?? (res.body && typeof res.body === "object" ? String((res.body as Record<string, unknown>).id ?? "") : "");
    if (!urn) return failure(this.platform, at, "LinkedIn accepted the post but returned no id", false);

    return {
      ok: true, platform: this.platform, externalId: urn,
      permalink: `https://www.linkedin.com/feed/update/${urn}`, at,
    };
  }

  async schedule(_req: PublishRequest, _token: OAuthToken, at: number): Promise<PublishResult> {
    return { ok: false, platform: this.platform, error: "native scheduling not supported — Populr will dispatch at time", at };
  }

  async delete(externalId: string, token: OAuthToken): Promise<{ ok: boolean; error?: string }> {
    if (!externalId) return { ok: false, error: "no post id" };
    const res = await request(`https://api.linkedin.com/rest/posts/${encodeURIComponent(externalId)}`, {
      method: "DELETE", headers: this.headers(token),
    });
    // Already gone is the desired end state, not a failure.
    if (res.status === 404) return { ok: true };
    return res.ok ? { ok: true } : { ok: false, error: describeError(res) };
  }

  /**
   * LinkedIn issues refresh tokens only to apps approved for them. Without one the token
   * simply expires and the member reconnects — so this returns the token unchanged rather
   * than inventing a new expiry the way the reference adapter does.
   */
  async refreshToken(token: OAuthToken): Promise<OAuthToken> {
    const app = appCredential("linkedin");
    if (!app || !token.refreshToken) return token;

    const res = await request("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
        client_id: app.clientId,
        client_secret: app.clientSecret,
      }).toString(),
    });
    if (!res.ok) return token;

    const b = res.body as Record<string, unknown>;
    const access = typeof b?.access_token === "string" ? b.access_token : null;
    if (!access) return token;
    const expiresIn = typeof b.expires_in === "number" ? b.expires_in : null;
    return {
      ...token,
      accessToken: access,
      refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : token.refreshToken,
      expiresAt: expiresIn != null ? this.now() + expiresIn * 1000 : token.expiresAt,
    };
  }

  async validateConnection(token: OAuthToken): Promise<ConnectionCheck> {
    if (!token.accessToken) return { ok: false, status: "disconnected" };
    if (token.expiresAt != null && token.expiresAt <= this.now()) return { ok: false, status: "expired", detail: "token expired" };

    const res = await request("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (res.status === 401) return { ok: false, status: "expired", detail: "LinkedIn rejected the token" };
    // A network blip is not evidence the connection is broken — do not mark it disconnected.
    if (!res.ok) return isRetryable(res.status)
      ? { ok: true, status: "connected", detail: `could not verify: ${describeError(res)}` }
      : { ok: false, status: "error", detail: describeError(res) };
    return { ok: true, status: "connected" };
  }
}

// ---------------------------------------------------------------- X

/**
 * X posts via the v2 tweets endpoint.
 *
 * Write access requires a paid API tier; on a free project the post call answers 403. That
 * surfaces as a plain non-retryable failure rather than a silent success.
 *
 * Media, like LinkedIn's, needs a separate upload endpoint and is not implemented.
 */
export class XAdapter implements SocialAdapter {
  readonly platform: SocialPlatform = "x";
  constructor(private now: () => number = Date.now) {}

  constraints(): PlatformConstraints {
    return { platform: this.platform, ...CONSTRAINTS.x, maxAssets: 0, allowsVideo: false };
  }

  async publish(req: PublishRequest, token: OAuthToken): Promise<PublishResult> {
    const at = this.now();
    const err = checkConstraints(this.platform, req);
    if (err) return failure(this.platform, at, err, false);

    const res = await request("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: req.content.text }),
    });

    if (!res.ok) {
      const detail = res.status === 403
        ? `X refused the post — v2 write access needs a paid API tier (${describeError(res)})`
        : describeError(res);
      return failure(this.platform, at, detail, isRetryable(res.status));
    }

    const data = (res.body as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    const id = data && typeof data.id === "string" ? data.id : "";
    if (!id) return failure(this.platform, at, "X accepted the post but returned no id", false);

    const handle = token.handle?.replace(/^@/, "") || "i";
    return { ok: true, platform: this.platform, externalId: id, permalink: `https://x.com/${handle}/status/${id}`, at };
  }

  async schedule(_req: PublishRequest, _token: OAuthToken, at: number): Promise<PublishResult> {
    return { ok: false, platform: this.platform, error: "native scheduling not supported — Populr will dispatch at time", at };
  }

  async delete(externalId: string, token: OAuthToken): Promise<{ ok: boolean; error?: string }> {
    if (!externalId) return { ok: false, error: "no post id" };
    const res = await request(`https://api.twitter.com/2/tweets/${encodeURIComponent(externalId)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (res.status === 404) return { ok: true };
    return res.ok ? { ok: true } : { ok: false, error: describeError(res) };
  }

  /** X refresh needs the offline.access scope and Basic auth with the app credentials. */
  async refreshToken(token: OAuthToken): Promise<OAuthToken> {
    const app = appCredential("x");
    if (!app || !token.refreshToken) return token;

    const basic = Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64");
    const res = await request("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
        client_id: app.clientId,
      }).toString(),
    });
    if (!res.ok) return token;

    const b = res.body as Record<string, unknown>;
    const access = typeof b?.access_token === "string" ? b.access_token : null;
    if (!access) return token;
    const expiresIn = typeof b.expires_in === "number" ? b.expires_in : null;
    return {
      ...token,
      accessToken: access,
      refreshToken: typeof b.refresh_token === "string" ? b.refresh_token : token.refreshToken,
      expiresAt: expiresIn != null ? this.now() + expiresIn * 1000 : token.expiresAt,
    };
  }

  async validateConnection(token: OAuthToken): Promise<ConnectionCheck> {
    if (!token.accessToken) return { ok: false, status: "disconnected" };
    if (token.expiresAt != null && token.expiresAt <= this.now()) return { ok: false, status: "expired", detail: "token expired" };

    const res = await request("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (res.status === 401) return { ok: false, status: "expired", detail: "X rejected the token" };
    if (!res.ok) return isRetryable(res.status)
      ? { ok: true, status: "connected", detail: `could not verify: ${describeError(res)}` }
      : { ok: false, status: "error", detail: describeError(res) };
    return { ok: true, status: "connected" };
  }
}

/** Live adapters for the platforms that have app credentials configured. */
export function createLiveAdapters(now: () => number = Date.now): Partial<Record<SocialPlatform, SocialAdapter>> {
  const out: Partial<Record<SocialPlatform, SocialAdapter>> = {};
  if (appCredential("linkedin")) out.linkedin = new LinkedInAdapter(now);
  if (appCredential("x")) out.x = new XAdapter(now);
  return out;
}

export { redact };
