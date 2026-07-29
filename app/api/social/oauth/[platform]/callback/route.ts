import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { readPlatform } from "@/lib/social/api-helpers";
import { exchangeCode, supportsLiveOAuth } from "@/lib/social/oauth-live";

export const runtime = "nodejs";

// Step 2: the provider sends the user back here with a code. Exchange it, identify the
// account, store the token encrypted, and return the user to the connections screen.
//
// This route always ends in a redirect, never JSON: a person is looking at it in a browser
// tab. Failures come back as a message in the query string so the page can explain itself.

const DONE = "/studio/integrations";

function back(req: NextRequest, params: Record<string, string>) {
  const to = new URL(DONE, req.nextUrl.origin);
  for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
  return NextResponse.redirect(to, 303);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  const platform = readPlatform((await ctx.params).platform);
  if (!platform || !supportsLiveOAuth(platform)) return back(req, { connect: "error", reason: "Unknown platform." });

  const cookieName = `populr_oauth_${platform}`;
  const clear = (res: NextResponse) => { res.cookies.set(cookieName, "", { path: "/", maxAge: 0 }); return res; };

  const session = await getSession();
  if (!session) return clear(back(req, { connect: "error", reason: "Your session expired. Sign in and try again." }));

  // The provider reports refusal in the URL rather than by failing the request.
  const denied = req.nextUrl.searchParams.get("error");
  if (denied) {
    const desc = req.nextUrl.searchParams.get("error_description") || denied;
    return clear(back(req, { connect: "error", reason: desc.slice(0, 160) }));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state) return clear(back(req, { connect: "error", reason: "The provider sent an incomplete response." }));

  // CSRF: the state must match the one we issued to this browser. Without this check an
  // attacker can hand a victim a callback URL and attach their own account to the session.
  const raw = req.cookies.get(cookieName)?.value;
  if (!raw) return clear(back(req, { connect: "error", reason: "The connection took too long. Start again." }));
  let saved: { state?: string; verifier?: string | null };
  try { saved = JSON.parse(raw); } catch { return clear(back(req, { connect: "error", reason: "The connection could not be verified. Start again." })); }
  if (!saved.state || saved.state !== state) {
    return clear(back(req, { connect: "error", reason: "The connection could not be verified. Start again." }));
  }

  const exchanged = await exchangeCode(platform, code, saved.verifier ?? null);
  if (!exchanged.ok) return clear(back(req, { connect: "error", reason: exchanged.error.slice(0, 160) }));

  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  const account = await socialEngine().connectAccountWithToken(tenant, platform, exchanged.token);

  return clear(back(req, { connect: "ok", platform, handle: account.handle }));
}
