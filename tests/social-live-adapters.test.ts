import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkedInAdapter, XAdapter, createLiveAdapters } from "@/lib/social/adapters-live";
import { describeError, isRetryable, redact } from "@/lib/social/http";
import { appCredential, isLive, redirectUri } from "@/lib/social/app-credentials";
import { buildAuthUrl, createPkce, liveScopes, supportsLiveOAuth } from "@/lib/social/oauth-live";
import type { OAuthToken, PublishRequest } from "@/lib/social/types";

// Every provider call is stubbed. These tests assert the shape of what we send and how we
// read what comes back — they must never reach LinkedIn or X.

const token: OAuthToken = {
  accessToken: "at_secret", refreshToken: "rt_secret", expiresAt: null,
  scopes: [], externalId: "member123", handle: "@kavya",
};

const req = (text: string): PublishRequest => ({
  tenant: "t", accountId: "acc", platform: "linkedin",
  content: { text, assetIds: [] }, assets: [],
});

function stubFetch(impl: (url: string, init?: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const r = impl(url, init as RequestInit);
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), {
      status: r.status,
      headers: r.headers ?? { "Content-Type": "application/json" },
    });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("redaction", () => {
  it("keeps bearer tokens out of anything loggable", () => {
    expect(redact("Authorization: Bearer abc.def-123")).not.toContain("abc.def-123");
    expect(redact('{"access_token":"secret"}')).not.toContain("secret");
    expect(redact("client_secret=hunter2&x=1")).not.toContain("hunter2");
  });
});

describe("retry classification", () => {
  it("retries only what is worth retrying", () => {
    expect(isRetryable(0)).toBe(true);      // no answer at all
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(400)).toBe(false);   // resending the same bad request cannot help
    expect(isRetryable(401)).toBe(false);
    expect(isRetryable(403)).toBe(false);
  });
});

describe("error description", () => {
  it("reads each provider's preferred field", () => {
    expect(describeError({ ok: false, status: 400, body: { message: "bad post" }, headers: null })).toBe("bad post");
    expect(describeError({ ok: false, status: 400, body: { detail: "duplicate" }, headers: null })).toBe("duplicate");
    expect(describeError({ ok: false, status: 400, body: { errors: [{ message: "too long" }] }, headers: null })).toBe("too long");
    expect(describeError({ ok: false, status: 500, body: null, headers: null })).toBe("provider returned 500");
  });
});

describe("LinkedIn adapter", () => {
  it("posts with the member urn and reads the id from the response header", async () => {
    let sent: { url: string; body: unknown } | null = null;
    stubFetch((url, init) => {
      sent = { url, body: JSON.parse(String(init?.body)) };
      return { status: 201, body: {}, headers: { "x-restli-id": "urn:li:share:987" } };
    });

    const out = await new LinkedInAdapter(() => 1000).publish(req("hello"), token);

    expect(out.ok).toBe(true);
    expect(out.externalId).toBe("urn:li:share:987");
    expect(out.permalink).toBe("https://www.linkedin.com/feed/update/urn:li:share:987");
    expect(sent!.url).toBe("https://api.linkedin.com/rest/posts");
    expect((sent!.body as Record<string, unknown>).author).toBe("urn:li:person:member123");
    expect((sent!.body as Record<string, unknown>).commentary).toBe("hello");
  });

  it("fails clearly when the member id is missing rather than posting to a broken urn", async () => {
    const spy = stubFetch(() => ({ status: 201, body: {} }));
    const out = await new LinkedInAdapter().publish(req("hi"), { ...token, externalId: "" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("reconnect");
    expect(spy).not.toHaveBeenCalled();   // never sends a request it knows is malformed
  });

  it("marks provider outages retryable and bad requests not", async () => {
    stubFetch(() => ({ status: 503, body: { message: "upstream" } }));
    expect((await new LinkedInAdapter().publish(req("x"), token)).error).toContain("(retryable)");

    vi.restoreAllMocks();
    stubFetch(() => ({ status: 400, body: { message: "malformed" } }));
    expect((await new LinkedInAdapter().publish(req("x"), token)).error).not.toContain("(retryable)");
  });

  it("rejects over-long text without calling the provider", async () => {
    const spy = stubFetch(() => ({ status: 201, body: {} }));
    const out = await new LinkedInAdapter().publish(req("a".repeat(3001)), token);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("3000");
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not claim native scheduling it does not have", async () => {
    const out = await new LinkedInAdapter().schedule(req("x"), token, 123);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("Populr will dispatch");
  });

  it("treats an already-deleted post as deleted", async () => {
    stubFetch(() => ({ status: 404, body: {} }));
    expect(await new LinkedInAdapter().delete("urn:li:share:1", token)).toEqual({ ok: true });
  });

  it("advertises no media, because media is not implemented", () => {
    const c = new LinkedInAdapter().constraints();
    expect(c.maxAssets).toBe(0);
    expect(c.allowsVideo).toBe(false);
    expect(c.maxText).toBe(3000);
  });

  it("does not mark a connection broken over a transient error", async () => {
    stubFetch(() => ({ status: 503, body: {} }));
    const check = await new LinkedInAdapter().validateConnection(token);
    expect(check.ok).toBe(true);
    expect(check.status).toBe("connected");
  });

  it("reports an expired token as expired", async () => {
    stubFetch(() => ({ status: 401, body: {} }));
    const check = await new LinkedInAdapter().validateConnection(token);
    expect(check.status).toBe("expired");
  });
});

describe("X adapter", () => {
  const xreq = (text: string): PublishRequest => ({ ...req(text), platform: "x" });

  it("posts the text and builds a permalink from the handle", async () => {
    stubFetch(() => ({ status: 201, body: { data: { id: "1750000000" } } }));
    const out = await new XAdapter(() => 5).publish(xreq("hello"), token);
    expect(out.ok).toBe(true);
    expect(out.externalId).toBe("1750000000");
    expect(out.permalink).toBe("https://x.com/kavya/status/1750000000");
  });

  it("explains a 403 as the paid-tier requirement, and does not retry it", async () => {
    stubFetch(() => ({ status: 403, body: { detail: "Unsupported Authentication" } }));
    const out = await new XAdapter().publish(xreq("hello"), token);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("paid API tier");
    expect(out.error).not.toContain("(retryable)");
  });

  it("enforces 280 characters before sending", async () => {
    const spy = stubFetch(() => ({ status: 201, body: {} }));
    const out = await new XAdapter().publish(xreq("a".repeat(281)), token);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("280");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fails rather than reporting success when no id comes back", async () => {
    stubFetch(() => ({ status: 201, body: {} }));
    const out = await new XAdapter().publish(xreq("hi"), token);
    expect(out.ok).toBe(false);
    expect(out.error).toContain("no id");
  });
});

describe("configuration", () => {
  it("stays on the reference adapter when no credentials are set", () => {
    // The suite runs without publishing credentials, which is the default everywhere.
    expect(appCredential("linkedin")).toBeNull();
    expect(isLive("linkedin")).toBe(false);
    expect(isLive("x")).toBe(false);
    expect(Object.keys(createLiveAdapters())).toHaveLength(0);
  });

  // Regression guard: X_CLIENT_ID belongs to "sign in with X". If publishing ever reads it
  // again, configuring login silently starts posting with scopes that cannot post.
  it("does not go live for X just because social login is configured", () => {
    vi.stubEnv("X_CLIENT_ID", "login-id");
    vi.stubEnv("X_CLIENT_SECRET", "login-secret");
    expect(appCredential("x")).toBeNull();
    expect(isLive("x")).toBe(false);
    vi.unstubAllEnvs();
  });

  it("goes live for X only on its own publishing credentials", () => {
    vi.stubEnv("X_PUBLISH_CLIENT_ID", "id");
    vi.stubEnv("X_PUBLISH_CLIENT_SECRET", "secret");
    expect(isLive("x")).toBe(true);
    vi.unstubAllEnvs();
  });

  it("refuses to build a consent URL without credentials instead of producing a broken one", () => {
    const built = buildAuthUrl("linkedin", "state123");
    expect("error" in built).toBe(true);
  });

  it("knows which platforms have a live flow at all", () => {
    expect(supportsLiveOAuth("linkedin")).toBe(true);
    expect(supportsLiveOAuth("x")).toBe(true);
    expect(supportsLiveOAuth("pinterest")).toBe(false);
  });

  it("asks only for scopes needed to post", () => {
    expect(liveScopes("linkedin")).toContain("w_member_social");
    expect(liveScopes("x")).toEqual(expect.arrayContaining(["tweet.write", "offline.access"]));
  });

  it("builds the callback path the developer app must register", () => {
    expect(redirectUri("linkedin")).toContain("/api/social/oauth/linkedin/callback");
  });
});

describe("registry swap", () => {
  // The whole design rests on this: setting credentials replaces the stub with the real
  // adapter, and every other platform is left alone. Asserted rather than assumed.
  it("swaps in live adapters when credentials appear, leaving the rest on reference", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");

    const { createAdapterRegistry, liveAdapterPlatforms } = await import("@/lib/social/registry");
    const reg = createAdapterRegistry(() => 1);

    expect(liveAdapterPlatforms()).toEqual(["linkedin"]);
    expect(reg.get("linkedin")).toBeInstanceOf(LinkedInAdapter);
    // Configuring LinkedIn must not quietly turn on X.
    expect(reg.get("x")).not.toBeInstanceOf(XAdapter);
    // Every platform still resolves to something — nothing is left without an adapter.
    expect(reg.platforms()).toHaveLength(6);

    vi.unstubAllEnvs();
  });

  it("reports the real LinkedIn limit through the live adapter, with media switched off", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");

    const { createAdapterRegistry } = await import("@/lib/social/registry");
    const c = createAdapterRegistry(() => 1).get("linkedin")!.constraints();

    expect(c.maxText).toBe(3000);
    expect(c.maxAssets).toBe(0);   // reference says 9; live says 0 until upload is built

    vi.unstubAllEnvs();
  });
});

describe("PKCE", () => {
  it("produces a fresh verifier each time and never puts it in the challenge", () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(a.verifier);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);   // RFC 7636 minimum
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]+$/);        // base64url, no padding
  });
});

describe("redirect URI", () => {
  // The single most common reason an OAuth flow fails in production. Providers compare
  // redirect_uri as an exact string and will not follow a redirect to reach it, so a URI
  // built from a static env var breaks as soon as the site answers on a second host —
  // which trypopulr.in does, 308-ing to www.
  it("is built from the host the request actually arrived on", () => {
    expect(redirectUri("linkedin", "https://www.trypopulr.in"))
      .toBe("https://www.trypopulr.in/api/social/oauth/linkedin/callback");
    expect(redirectUri("x", "https://trypopulr.in"))
      .toBe("https://trypopulr.in/api/social/oauth/x/callback");
  });

  it("never leaves a trailing slash to double up", () => {
    expect(redirectUri("linkedin", "https://www.trypopulr.in/"))
      .toBe("https://www.trypopulr.in/api/social/oauth/linkedin/callback");
  });

  it("lets an explicit override win, for proxies and previews", () => {
    vi.stubEnv("SOCIAL_REDIRECT_BASE", "https://fixed.example");
    expect(redirectUri("linkedin", "https://preview-abc.vercel.app"))
      .toBe("https://fixed.example/api/social/oauth/linkedin/callback");
    vi.unstubAllEnvs();
  });

  it("puts the same URI in the consent URL that it hands back for the exchange", () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");

    const built = buildAuthUrl("linkedin", "state123", undefined, "https://www.trypopulr.in");
    expect("error" in built).toBe(false);
    if ("error" in built) return;

    // The two must agree, or the exchange fails after the user has already consented —
    // the worst place to discover a mismatch.
    const sent = new URL(built.authUrl).searchParams.get("redirect_uri");
    expect(sent).toBe(built.redirectUri);
    expect(sent).toBe("https://www.trypopulr.in/api/social/oauth/linkedin/callback");

    vi.unstubAllEnvs();
  });

  it("sends X through PKCE with a challenge, never the verifier", () => {
    vi.stubEnv("X_PUBLISH_CLIENT_ID", "id");
    vi.stubEnv("X_PUBLISH_CLIENT_SECRET", "secret");

    const pkce = createPkce();
    const built = buildAuthUrl("x", "s", pkce, "https://www.trypopulr.in");
    expect("error" in built).toBe(false);
    if ("error" in built) return;

    const q = new URL(built.authUrl).searchParams;
    expect(q.get("code_challenge")).toBe(pkce.challenge);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(built.authUrl).not.toContain(pkce.verifier);
    expect(q.get("scope")).toContain("tweet.write");

    vi.unstubAllEnvs();
  });

  it("replays the given URI at exchange time rather than rebuilding it", async () => {
    vi.stubEnv("LINKEDIN_CLIENT_ID", "id");
    vi.stubEnv("LINKEDIN_CLIENT_SECRET", "secret");

    let sentBody = "";
    stubFetch((url, init) => {
      if (url.includes("accessToken")) { sentBody = String(init?.body); return { status: 200, body: { access_token: "at" } }; }
      return { status: 200, body: { sub: "member1", name: "Kavya" } };
    });

    const { exchangeCode } = await import("@/lib/social/oauth-live");
    const out = await exchangeCode("linkedin", "code1", null, "https://www.trypopulr.in/api/social/oauth/linkedin/callback");

    expect(out.ok).toBe(true);
    expect(decodeURIComponent(sentBody)).toContain("https://www.trypopulr.in/api/social/oauth/linkedin/callback");

    vi.unstubAllEnvs();
  });
});
