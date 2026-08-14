import { NextRequest, NextResponse } from "next/server";
import { Checkout } from "@polar-sh/nextjs";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { billingConfig } from "@/lib/billing/polar";
import { SITE_URL } from "@/lib/seo";

export const runtime = "nodejs";

// Starting a subscription.
//
// Two things this route has to get right, and the second one was got wrong first.
//
// 1. The customer is decided here, not by the caller.
//
// Polar's `Checkout()` reads `products` and `customerExternalId` from the query string.
// Mounted the way the quickstart shows — `export const GET = Checkout({...})` — anyone can
// call ?customerExternalId=<someone else's id> and attach a subscription to another
// person's account. So the query string is rebuilt from the session and everything the
// client sent is discarded.
//
// 2. A browser is navigating here, so every outcome must be a redirect.
//
// This used to answer failures with JSON. A navigation that receives application/json does
// not show an error — depending on the browser it renders raw JSON or, as happened here,
// silently downloads a file named "checkout" and leaves the page exactly where it was. The
// person clicked Subscribe and nothing happened.
//
// Every path now ends in a redirect carrying a reason the Settings page can explain. Nothing
// returns a body.

/** Back to the plan panel with something it can say out loud. */
function back(reason: string) {
  const url = new URL("/studio/integrations", SITE_URL);
  url.searchParams.set("billing", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/app?signin=1", SITE_URL));

  const limit = rateLimit(`checkout:${requestKey(req.headers, session.userId)}`, 10, 60_000);
  if (!limit.allowed) return back("rate_limited");

  const cfg = billingConfig();
  if (!cfg.configured) return back("not_configured");

  // Rebuilt from scratch. Whatever arrived in the query string is dropped.
  const url = new URL(req.url);
  url.search = "";
  url.searchParams.set("products", cfg.productId);
  // externalCustomerId is Polar's own field for "your id for this person". Using it rather
  // than metadata alone means Polar links its customer to our user natively, which is what
  // makes the billing portal resolvable later without storing a second id.
  url.searchParams.set("customerExternalId", session.userId);
  if (session.email) url.searchParams.set("customerEmail", session.email);
  url.searchParams.set("metadata", JSON.stringify({ user_id: session.userId }));

  const handler = Checkout({
    accessToken: cfg.token,
    server: cfg.server,
    theme: "dark",
    // Access is not live the moment they land — the webhook arrives on its own schedule —
    // so the panel polls rather than assuming. See app/components/Billing.tsx.
    successUrl: `${SITE_URL}/app?subscribed=1`,
  });

  try {
    const res = await handler(new NextRequest(url, req));

    // The adapter answers with JSON when Polar refuses — a bad token, a product that does
    // not exist, the wrong environment. Turn that into a redirect too, or the browser gets
    // a file instead of a page.
    if (!res.headers.get("location")) {
      const detail = await res.clone().text().catch(() => "");
      // Logged with the environment and product alongside the error, because the two most
      // common causes are invisible in Polar's message: a production token pointed at the
      // sandbox API (or the reverse), and a product id from the other environment. Polar
      // answers both with a flat "not found", which is true and unhelpful on its own.
      console.error(JSON.stringify({
        event: "checkout_no_redirect",
        status: res.status,
        server: cfg.server,
        productId: cfg.productId,
        tokenPrefix: cfg.token.slice(0, 12),
        detail: detail.slice(0, 400),
      }));
      return back("checkout_failed");
    }

    console.info(JSON.stringify({ event: "checkout_started", userId: session.userId }));
    return res;
  } catch (e) {
    // The SDK throws on network trouble and on some API rejections. An uncaught throw here
    // is a 500, which the browser also declines to render.
    console.error(JSON.stringify({
      event: "checkout_threw", server: cfg.server, productId: cfg.productId, detail: String(e).slice(0, 400),
    }));
    return back("checkout_failed");
  }
}
