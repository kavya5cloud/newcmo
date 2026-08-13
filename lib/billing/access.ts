// Who may use the product, and why.
//
// Two gates called isTrialActive() directly, so "can this account generate" and "is this
// account inside its first 30 days" were the same question. They stop being the same
// question the moment anyone pays. This is the question the gates should ask instead.
//
// Deliberately pure and provider-free. Polar decides whether a subscription is active;
// this decides what an active subscription means for access, and it does so from plain data
// with an injected clock — so it is testable without a network, a database, or a webhook.

export type SubscriptionStatus =
  /** Paying, or inside a provider-side trial. Full access. */
  | "active"
  /** Cancelled but paid through a date that has not arrived. Full access until then. */
  | "canceled"
  /** Payment failed. Access continues briefly — see GRACE_DAYS. */
  | "past_due"
  /** Over, refunded, or never started. No access beyond the local trial. */
  | "revoked";

export type Subscription = {
  userId: string;
  status: SubscriptionStatus;
  /** Provider subscription id, for support and for the customer portal. */
  externalId: string;
  /** Paid through this instant. Access survives to here even after cancellation. */
  currentPeriodEnd: number | null;
  /** Which product was bought, so a plan change is visible without calling the API. */
  productId: string | null;
  updatedAt: number;
};

/**
 * How long a failed payment keeps access.
 *
 * A card expiring should not lock someone out of their marketing the same morning. Three
 * days is enough for a retry and an email to land, and short enough that it is not a free
 * plan by accident.
 */
export const GRACE_DAYS = 3;
const DAY = 86_400_000;

export type AccessInput = {
  /** When the local free trial ends. Null when there is no account row to date it from. */
  trialEndsAt: number | null;
  subscription: Subscription | null;
};

export type AccessReason = "trial" | "subscription" | "grace" | "period_remaining" | "trial_ended" | "payment_failed";

export type Access = {
  allowed: boolean;
  reason: AccessReason;
  /** When this access lapses, if it is time-limited. */
  until: number | null;
};

/**
 * The one access decision.
 *
 * Order matters and is not arbitrary: a paying customer is never told their trial ended, and
 * someone still inside a paid period they cancelled keeps what they paid for. Both are ways
 * a billing integration insults a customer who did nothing wrong.
 */
export function accessFor(input: AccessInput, now: number = Date.now()): Access {
  const sub = input.subscription;

  if (sub) {
    if (sub.status === "active") {
      return { allowed: true, reason: "subscription", until: sub.currentPeriodEnd };
    }

    // Cancelled is not expired. They paid through a date; honour it.
    if (sub.status === "canceled" && sub.currentPeriodEnd && now < sub.currentPeriodEnd) {
      return { allowed: true, reason: "period_remaining", until: sub.currentPeriodEnd };
    }

    if (sub.status === "past_due") {
      const graceEnds = sub.updatedAt + GRACE_DAYS * DAY;
      if (now < graceEnds) return { allowed: true, reason: "grace", until: graceEnds };
      return { allowed: false, reason: "payment_failed", until: null };
    }
  }

  // No subscription, or a dead one: fall back to the local free trial.
  if (input.trialEndsAt != null && now < input.trialEndsAt) {
    return { allowed: true, reason: "trial", until: input.trialEndsAt };
  }

  // A failed payment is a different message from a finished trial, even though both end in
  // no access — one asks for a new card, the other asks for a decision.
  if (sub?.status === "past_due") return { allowed: false, reason: "payment_failed", until: null };
  return { allowed: false, reason: "trial_ended", until: input.trialEndsAt };
}

/**
 * What to tell the person. Each reason gets the sentence that changes their situation.
 *
 * Never "upgrade to continue" pointing at nothing — that message shipped once and turned a
 * working gate into what looked like a broken app.
 */
export const ACCESS_MESSAGE: Record<AccessReason, string> = {
  trial: "You're on the free trial.",
  subscription: "Your subscription is active.",
  grace: "We couldn't take your last payment. Update your card to avoid losing access.",
  period_remaining: "Your subscription is cancelled but paid up — access continues until the end of the period.",
  trial_ended: "Your free month has ended. Subscribe to continue, or refer 3 people from Settings to add another 30 days.",
  payment_failed: "Your last payment failed, so access is paused. Update your card to restore it.",
};

/** Statuses a provider webhook may set. Anything unrecognised is treated as revoked. */
export function normalizeStatus(raw: string): SubscriptionStatus {
  const s = (raw || "").toLowerCase().trim();
  if (s === "active" || s === "trialing") return "active";
  if (s === "canceled" || s === "cancelled") return "canceled";
  if (s === "past_due" || s === "unpaid" || s === "incomplete") return "past_due";
  // Unknown means unknown. Defaulting an unrecognised status to "active" is how a refunded
  // account keeps its access forever, and it is silent — nobody reports being over-served.
  return "revoked";
}
