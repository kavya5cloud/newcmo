import { NextRequest, NextResponse } from "next/server";
import { CustomerPortal } from "@polar-sh/nextjs";
import { getSession } from "@/lib/auth";
import { billingConfig } from "@/lib/billing/polar";
import { SITE_URL } from "@/lib/seo";

export const runtime = "nodejs";

// Managing an existing subscription — card, invoices, cancellation.
//
// Polar hosts this screen. Building it ourselves would mean handling card details, which is
// a compliance burden nobody should take on for a page that already exists.
//
// getExternalCustomerId reads the session and nothing else. The adapter's own type allows a
// request-derived id, and taking one from the query string here would let anyone open
// anyone else's billing portal by guessing a user id — the same hole as the checkout route,
// with worse consequences, since the portal shows payment history.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/app?signin=1", SITE_URL));

  const cfg = billingConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "billing_not_configured", hint: "Subscriptions aren't switched on yet." },
      { status: 503 },
    );
  }

  const handler = CustomerPortal({
    accessToken: cfg.token,
    server: cfg.server,
    returnUrl: `${SITE_URL}/studio/integrations`,
    // The id checkout attached to the customer. Never read from the request.
    getExternalCustomerId: async () => session.userId,
  });

  return handler(req);
}
