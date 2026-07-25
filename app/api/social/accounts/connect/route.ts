import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { readPlatform } from "@/lib/social/api-helpers";

export const runtime = "nodejs";

// Connect a social account via OAuth. The token is stored encrypted; it is never returned.
// (In reference mode the OAuth code exchange is deterministic; real OAuth swaps in here.)
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 8, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const platform = readPlatform(body.platform);
  if (!platform) return NextResponse.json({ error: "invalid_platform" }, { status: 422 });
  const code = String(body.code || `code_${Date.now()}`);
  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";

  const account = await socialEngine().connectAccount(tenant, platform, code, body.handle as string | undefined);
  return NextResponse.json({ ok: true, account });
}
