import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { socialEngine } from "@/lib/social/shared";

export const runtime = "nodejs";

// Disconnect an account — removes the encrypted credential and marks it disconnected.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 8, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const accountId = String(body.accountId || "");
  if (!accountId) return NextResponse.json({ error: "missing_account" }, { status: 422 });
  const ok = await socialEngine().disconnectAccount(accountId);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
