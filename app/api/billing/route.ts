import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { accessForUser, accessMessage } from "@/lib/billing/gate";
import { billingConfig } from "@/lib/billing/polar";
import { subscriptionRepo } from "@/lib/billing/store";
import { SITE_URL } from "@/lib/seo";

export const runtime = "nodejs";

// What this account's access looks like, for rendering.
//
// Read-only, and that is the whole design. Starting a subscription is a navigation to
// /api/billing/checkout and managing one is a navigation to /api/billing/portal — both
// server-side redirects into Polar's hosted pages.
//
// Nothing here grants access. Only the webhook does, because only the webhook has proof a
// payment happened; a checkout URL means somebody clicked a button.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const limit = rateLimit(requestKey(req.headers, session.userId), 60, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const [access, sub] = await Promise.all([
    accessForUser(session.userId),
    subscriptionRepo().get(session.userId).catch(() => null),
  ]);

  return NextResponse.json({
    ok: true,
    allowed: access.allowed,
    reason: access.reason,
    until: access.until,
    message: accessMessage(access),
    // The UI needs to know whether to offer subscribing at all. With no billing configured
    // there is nothing behind the button, and a button that cannot work should not exist.
    canSubscribe: billingConfig().configured,
    subscribed: Boolean(sub && sub.status !== "revoked"),
    // A comped subscription has no Polar customer behind it, so the portal would open on
    // nothing. Offering "Manage billing" for a row we wrote by hand is a button that cannot
    // work — the panel offers Subscribe instead.
    manageable: Boolean(sub && sub.status !== "revoked" && !sub.externalId.startsWith("comp_")),
    status: sub?.status ?? null,
    daysLeft: access.until ? Math.max(0, Math.ceil((access.until - Date.now()) / 86_400_000)) : null,
  });
}
