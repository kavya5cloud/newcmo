import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { accessForUser, accessMessage } from "@/lib/billing/gate";
import { billingConfig, createCheckout, createPortalSession } from "@/lib/billing/polar";
import { subscriptionRepo } from "@/lib/billing/store";
import { SITE_URL } from "@/lib/seo";

export const runtime = "nodejs";

// Billing, from the browser's side.
//
// GET            — what this account's access looks like, for rendering.
// POST {checkout}— start a subscription, returns a URL to send them to.
// POST {portal}  — manage an existing one, returns a URL to send them to.
//
// Neither POST ever grants access. Only the webhook does that, because only the webhook has
// proof a payment happened. A checkout that returns a URL means someone clicked a button,
// which is not the same as someone paying — wiring access to the click is how a product ends
// up giving itself away to anyone who opens devtools.

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
    status: sub?.status ?? null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  // Tight: each call hits Polar, and nobody legitimately needs many checkouts a minute.
  const limit = rateLimit(`billing:${requestKey(req.headers, session.userId)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited", hint: "Too many attempts — wait a minute." }, { status: 429 });
  }

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!billingConfig().configured) {
    return NextResponse.json(
      { error: "billing_not_configured", hint: "Subscriptions aren't switched on yet." },
      { status: 503 },
    );
  }

  if (body.action === "portal") {
    const sub = await subscriptionRepo().get(session.userId).catch(() => null);
    if (!sub) {
      return NextResponse.json(
        { error: "no_subscription", hint: "There's no subscription to manage yet." },
        { status: 400 },
      );
    }
    // Identified by our user id, which is what checkout attached to the customer — so the
    // portal opens for the right person without us storing a second provider id.
    const r = await createPortalSession(session.userId);
    if ("error" in r) {
      return NextResponse.json({ error: r.error, hint: "Couldn't open the billing portal. Try again shortly." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, url: r.url });
  }

  // Default: start a subscription. The session already carries the email, so there is no
  // second lookup and no chance of the two disagreeing.
  const r = await createCheckout({
    userId: session.userId,
    email: session.email || null,
    // Back to the dashboard. Access will not be live the instant they land — the webhook
    // arrives on its own schedule — which is why the UI polls rather than assuming.
    successUrl: `${SITE_URL}/app?subscribed=1`,
  });

  if ("error" in r) {
    return NextResponse.json(
      { error: r.error, hint: "Couldn't start checkout. Try again shortly." },
      { status: r.error === "billing_not_configured" ? 503 : 502 },
    );
  }

  console.info(JSON.stringify({ event: "checkout_started", userId: session.userId }));
  return NextResponse.json({ ok: true, url: r.url });
}
