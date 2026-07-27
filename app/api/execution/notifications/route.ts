import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { assembleSnapshot, loadContext, tenantOf } from "@/lib/execution/api-helpers";
import { executionPlatform } from "@/lib/execution/shared";

export const runtime = "nodejs";

// Notifications — derived on read (stable ids) and dismissed on write. Dismissals are the
// only stored part, so a notification that becomes true again is not lost forever, but one
// you've dealt with stays gone.

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 120 : 40, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = await tenantOf(req.nextUrl.searchParams.get("wsid"));
  try {
    const ctx = await loadContext(tenant, req.nextUrl.searchParams.get("launchId"));
    const snapshot = await assembleSnapshot(ctx, Date.now());
    return NextResponse.json({ ok: true, notifications: snapshot.notifications });
  } catch (e) {
    return NextResponse.json({ error: "notifications_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const id = String(body.id || "");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 422 });

  const tenant = await tenantOf((body.wsid as string) ?? null);
  try {
    const ctx = await loadContext(tenant, (body.launchId as string) ?? null);
    await executionPlatform().dismissals.dismiss(tenant, ctx.plan.launchId, id, Date.now());
    return NextResponse.json({ ok: true, dismissed: id });
  } catch (e) {
    return NextResponse.json({ error: "dismiss_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
