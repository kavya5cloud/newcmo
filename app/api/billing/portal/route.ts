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
//
// And as with checkout: a browser is navigating here, so every outcome is a redirect. A
// failure answered with JSON does not show an error — it downloads a file called "portal"
// and leaves the page where it was.

/** Back to the plan panel with something it can say out loud. */
function back(reason: string) {
  const url = new URL("/studio/integrations", SITE_URL);
  url.searchParams.set("billing", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/app?signin=1", SITE_URL));

  const cfg = billingConfig();
  if (!cfg.configured) return back("not_configured");

  const handler = CustomerPortal({
    accessToken: cfg.token,
    server: cfg.server,
    returnUrl: `${SITE_URL}/studio/integrations`,
    // The id checkout attached to the customer. Never read from the request.
    getExternalCustomerId: async () => session.userId,
  });

  try {
    const res = await handler(req);
    if (!res.headers.get("location")) {
      // Most often: no Polar customer exists for this account yet, which is true for a
      // comped subscription written by hand.
      const detail = await res.clone().text().catch(() => "");
      console.error(JSON.stringify({ event: "portal_no_redirect", status: res.status, detail: detail.slice(0, 300) }));
      return back("portal_unavailable");
    }
    return res;
  } catch (e) {
    console.error(JSON.stringify({ event: "portal_threw", detail: String(e).slice(0, 300) }));
    return back("portal_unavailable");
  }
}
