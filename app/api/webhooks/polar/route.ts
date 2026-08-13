import { NextRequest, NextResponse } from "next/server";
import { normalizeStatus } from "@/lib/billing/access";
import { subscriptionRepo } from "@/lib/billing/store";
import { isHandled, parseSubscriptionEvent, verifyWebhook } from "@/lib/billing/webhook";

export const runtime = "nodejs";

// Polar tells us who is paying.
//
// This route grants paid access, so it is the most security-sensitive endpoint in the
// product. Anyone able to POST an accepted body here can give themselves a subscription.
// Three rules follow from that, and none of them are optional:
//
//   The raw body is read as text and verified before anything else touches it. req.json()
//   would re-serialise, and a re-serialised body has a different signature — key order and
//   whitespace are not preserved. Verification would then fail for every real event, and the
//   tempting fix is to stop verifying.
//
//   The user is identified by metadata we set at checkout, never by email. Two accounts can
//   share an address, and an email in a payload is not proof of who owns it.
//
//   An unverified request gets 401 and changes nothing. An unrecognised event gets 200 and
//   changes nothing — retrying us forever over an event we do not handle helps nobody.

export async function POST(req: NextRequest) {
  const secret = process.env.POLAR_WEBHOOK_SECRET || "";

  // Read once, as text. This is the exact string that was signed.
  const rawBody = await req.text();

  const verified = verifyWebhook({
    rawBody,
    headers: {
      id: req.headers.get("webhook-id"),
      timestamp: req.headers.get("webhook-timestamp"),
      signature: req.headers.get("webhook-signature"),
    },
    secret,
  });

  if (!verified.ok) {
    // The reason is logged, never returned — telling a prober whether the signature or the
    // timestamp failed helps them and nobody else.
    console.warn(JSON.stringify({ event: "polar_webhook_rejected", reason: verified.reason }));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: { type?: string; data?: unknown };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const type = String(payload.type || "");
  if (!isHandled(type)) {
    // Acknowledged deliberately. A 4xx here makes the provider retry an event we will never
    // handle, forever.
    return NextResponse.json({ ok: true, ignored: type });
  }

  const parsed = parseSubscriptionEvent(payload);
  if (!parsed) {
    console.warn(JSON.stringify({ event: "polar_webhook_unparsed", type }));
    return NextResponse.json({ ok: true, ignored: "unparsed" });
  }

  const repo = subscriptionRepo();

  // Prefer the checkout metadata; fall back to a subscription we already know, which covers
  // renewals and cancellations where metadata is not resent.
  const known = await repo.byExternalId(parsed.externalId).catch(() => null);
  const userId = parsed.userId ?? known?.userId ?? null;

  if (!userId) {
    // Loud, because it means checkout is not passing user_id and every payment from now on
    // is unattributable. Still 200: retrying will not add the metadata.
    console.error(JSON.stringify({
      event: "polar_webhook_no_user",
      type,
      externalId: parsed.externalId,
      hint: "checkout must set metadata.user_id — see lib/billing/webhook.ts",
    }));
    return NextResponse.json({ ok: true, ignored: "no_user" });
  }

  const status = normalizeStatus(parsed.status);

  await repo.upsert({
    userId,
    externalId: parsed.externalId,
    status,
    currentPeriodEnd: parsed.currentPeriodEnd,
    productId: parsed.productId,
    // Our clock, not theirs: the grace period is measured from when we learned a payment
    // failed, and a provider timestamp we cannot verify should not extend it.
    updatedAt: Date.now(),
  });

  console.info(JSON.stringify({ event: "polar_webhook", type, userId, status }));
  return NextResponse.json({ ok: true });
}
