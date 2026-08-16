import { Webhooks } from "@polar-sh/nextjs";
import { normalizeStatus } from "@/lib/billing/access";
import { billingConfig } from "@/lib/billing/polar";
import { subscriptionRepo } from "@/lib/billing/store";
import { isHandled } from "@/lib/billing/webhook";

export const runtime = "nodejs";

// Polar tells us who is paying.
//
// Signature verification is the adapter's now. That is a real improvement rather than a
// convenience: the hand-rolled version implemented Standard Webhooks from the spec and
// carried a warning that it had never been checked against a live event. A signature check
// that is subtly wrong fails in the worst direction — it either rejects every real payment,
// or accepts forged ones. This one is maintained by the people who sign the events.
//
// What remains ours is what the events mean. Two rules that have not changed:
//
//   Only this route grants access. The checkout route returning a URL means somebody clicked
//   a button, which is not the same as somebody paying.
//
//   The user comes from the id we attached at checkout, never from the customer email. Two
//   accounts can share an address, and an email in a payload proves nothing.

type SubscriptionLike = {
  id?: string;
  status?: string;
  currentPeriodEnd?: Date | string | null;
  productId?: string | null;
  metadata?: Record<string, unknown>;
  customer?: { externalId?: string | null } | null;
};

/** Our user id, from the two places checkout put it. */
function userIdOf(sub: SubscriptionLike): string | null {
  const external = sub.customer?.externalId;
  if (typeof external === "string" && external) return external;
  const meta = sub.metadata?.user_id;
  return typeof meta === "string" && meta ? meta : null;
}

function periodEnd(raw: SubscriptionLike["currentPeriodEnd"]): number | null {
  if (!raw) return null;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Record whatever Polar just told us.
 *
 * One handler for every subscription event. They differ in name and in the status they
 * carry, not in what we do with them — write down the current state and let
 * lib/billing/access.ts decide what it means. Branching per event type here would put the
 * access rules in two places.
 */
async function record(type: string, data: SubscriptionLike): Promise<void> {
  const externalId = typeof data.id === "string" ? data.id : "";
  if (!externalId) return;

  const repo = subscriptionRepo();
  // Renewals and cancellations may not resend the checkout metadata, so fall back to the
  // subscription we already know.
  const known = await repo.byExternalId(externalId).catch(() => null);
  const userId = userIdOf(data) ?? known?.userId ?? null;

  if (!userId) {
    // Loud: it means checkout stopped attaching the customer id, and every payment from now
    // on is unattributable. Not an error response — retrying will not add the field.
    console.error(JSON.stringify({
      event: "polar_webhook_no_user", type, externalId,
      hint: "checkout must set customerExternalId — see app/api/billing/checkout/route.ts",
    }));
    return;
  }

  const status = normalizeStatus(String(data.status ?? ""));

  await repo.upsert({
    userId,
    externalId,
    status,
    currentPeriodEnd: periodEnd(data.currentPeriodEnd),
    productId: typeof data.productId === "string" ? data.productId : null,
    // Our clock, not theirs. The grace period after a failed payment is measured from when
    // we learned, and a provider timestamp we cannot verify should not extend it.
    updatedAt: Date.now(),
  });

  console.info(JSON.stringify({ event: "polar_webhook", type, userId, status }));
}

export const POST = Webhooks({
  // Empty in the adapter means every event is rejected, which is the correct posture for an
  // endpoint that grants paid access when it is not yet configured.
  webhookSecret: billingConfig().webhookSecret,

  // One catch-all instead of six named handlers.
  //
  // The named handlers covered six of the ten types HANDLED_EVENTS then listed, and the
  // adapter exposes no hook for the rest — there is no onSubscriptionPastDue. So a list
  // called HANDLED_EVENTS named four events that nothing handled, and the mismatch was
  // invisible: both files read correctly on their own.
  //
  // (Three of those four turned out to be unparseable by the SDK entirely and have since
  // been dropped from the list. See the note on HANDLED_EVENTS.)
  //
  // The expensive one was past_due. A failed renewal left the stored status on "active"
  // forever, and accessFor() grants access on "active" without consulting the period end —
  // so a customer whose card stopped working kept everything, indefinitely, and the grace
  // period in accessFor() was unreachable code.
  //
  // onPayload receives every event, so the routing decision moves to isHandled() and
  // HANDLED_EVENTS becomes what its name claims: the one place that says which events
  // matter. Adding a type there now actually handles it.
  onPayload: async (payload) => {
    if (!isHandled(payload.type)) return;
    await record(payload.type, (payload as { data: unknown }).data as SubscriptionLike);
  },
});
