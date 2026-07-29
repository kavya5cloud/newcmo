import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { readPlatform } from "@/lib/social/api-helpers";
import { appCredential } from "@/lib/social/app-credentials";
import { buildAuthUrl, createPkce, createState, supportsLiveOAuth } from "@/lib/social/oauth-live";

export const runtime = "nodejs";

// Step 1 of connecting a real account: send the user to the provider's consent screen.
//
// The CSRF state and the PKCE verifier are stashed in a short-lived httpOnly cookie. They
// must survive a round trip through a site we do not control and come back matching, and
// the verifier is a secret — it cannot go in the URL, and it must not be readable by page
// scripts.

/** Ten minutes is longer than any consent screen takes and short enough to be disposable. */
const FLOW_TTL_S = 600;

export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  const session = await getSession();
  // Connecting an account is an authenticated action: it attaches a real identity to a
  // workspace. An anonymous visitor has no workspace to attach it to.
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const limit = rateLimit(requestKey(req.headers, session.userId), 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const platform = readPlatform((await ctx.params).platform);
  if (!platform) return NextResponse.json({ error: "invalid_platform" }, { status: 422 });
  if (!supportsLiveOAuth(platform)) {
    return NextResponse.json({ error: "no_live_oauth", hint: `${platform} has no live connection yet.` }, { status: 501 });
  }
  if (!appCredential(platform)) {
    return NextResponse.json(
      { error: "not_configured", hint: `Set ${platform === "linkedin" ? "LINKEDIN" : "X"}_CLIENT_ID and _CLIENT_SECRET.` },
      { status: 503 },
    );
  }

  const state = createState();
  const pkce = platform === "x" ? createPkce() : undefined;
  const built = buildAuthUrl(platform, state, pkce);
  if ("error" in built) return NextResponse.json({ error: "oauth_unavailable", hint: built.error }, { status: 503 });

  const res = NextResponse.redirect(built.authUrl, 302);
  res.cookies.set(`populr_oauth_${platform}`, JSON.stringify({ state, verifier: pkce?.verifier ?? null }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",   // must survive the provider's redirect back to us
    path: "/",
    maxAge: FLOW_TTL_S,
  });
  return res;
}
