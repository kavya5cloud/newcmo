import { NextRequest, NextResponse } from "next/server";
import { Checkout } from "@polar-sh/nextjs";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { billingConfig } from "@/lib/billing/polar";
import { SITE_URL } from "@/lib/seo";

export const runtime = "nodejs";

// Starting a subscription.
//
// Polar's adapter is wrapped rather than exported directly, and the reason is the whole
// point of this file.
//
// `Checkout()` reads `products` and `customerExternalId` from the query string. Mounted as
// the quickstart shows it — `export const GET = Checkout({...})` — anyone can call
//
//     /api/billing/checkout?products=<any>&customerExternalId=<anyone's id>
//
// and open a checkout that attaches to another person's account, or to a product that is not
// the one being sold. The identity would be whatever the caller typed.
//
// So the request is rebuilt server-side: the session decides who the customer is, the
// environment decides which product, and anything the client sent for either is discarded.
// The only query parameter that survives is nothing.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    // Send them to sign in rather than returning JSON — this is a navigation, not a fetch.
    return NextResponse.redirect(new URL("/app?signin=1", SITE_URL));
  }

  const limit = rateLimit(`checkout:${requestKey(req.headers, session.userId)}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited", hint: "Too many attempts — wait a minute." }, { status: 429 });
  }

  const cfg = billingConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "billing_not_configured", hint: "Subscriptions aren't switched on yet." },
      { status: 503 },
    );
  }

  // Rebuilt from scratch. Whatever arrived in the query string is dropped.
  const url = new URL(req.url);
  url.search = "";
  url.searchParams.set("products", cfg.productId);
  // externalCustomerId is Polar's own field for "your id for this person". Using it rather
  // than metadata means Polar links its customer to our user natively — which is also what
  // makes the billing portal resolvable later without storing a second id.
  url.searchParams.set("customerExternalId", session.userId);
  if (session.email) url.searchParams.set("customerEmail", session.email);
  // Kept as well as externalCustomerId: the webhook reads metadata.user_id, and belt-and-
  // braces on the one field the entire integration hangs on is cheap.
  url.searchParams.set("metadata", JSON.stringify({ user_id: session.userId }));

  const handler = Checkout({
    accessToken: cfg.token,
    server: cfg.server,
    theme: "dark",
    // Access is not live the moment they land — the webhook arrives on its own schedule —
    // so the dashboard polls rather than assuming. See app/components/Billing.tsx.
    successUrl: `${SITE_URL}/app?subscribed=1`,
  });

  console.info(JSON.stringify({ event: "checkout_started", userId: session.userId }));
  return handler(new NextRequest(url, req));
}
