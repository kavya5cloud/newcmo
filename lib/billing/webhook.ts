import { createHmac, timingSafeEqual } from "node:crypto";

// Verifying that a webhook really came from the payment provider.
//
// This endpoint grants paid access. Anyone who can POST to it can hand themselves a
// subscription, so an unverified webhook route is not a billing integration — it is a
// public "make me a customer" button. Verification is the feature.
//
// Polar signs with Standard Webhooks (standardwebhooks.com): three headers, and an HMAC over
// `{id}.{timestamp}.{body}` keyed on a base64 secret. The secret is issued as `whsec_<b64>`.
//
// VERIFY THIS AGAINST POLAR'S CURRENT DOCS BEFORE GOING LIVE. The scheme is stable and
// widely implemented, but a signature check that is subtly wrong fails in the worst
// direction — it either rejects every real event, or accepts forged ones.

export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type VerifyInput = {
  /** The exact bytes that were signed. Never a re-serialised object — see below. */
  rawBody: string;
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  };
  secret: string;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_secret" | "missing_headers" | "stale" | "bad_signature" };

/** Strip the `whsec_` prefix and decode. The signing key is the decoded bytes, not the string. */
function keyFrom(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return Buffer.from(raw, "base64");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length — compare
  // lengths first and always run the constant-time check on equal-length buffers.
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/**
 * Whether this request was signed by the provider.
 *
 * The timestamp check is not ceremony: without it a signature stays valid forever, so an
 * intercepted "subscription active" event could be replayed after a refund.
 */
export function verifyWebhook(input: VerifyInput, now: number = Date.now()): VerifyResult {
  const { rawBody, headers, secret } = input;
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: "missing_headers" };

  const sent = Number(headers.timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "missing_headers" };
  if (Math.abs(now / 1000 - sent) > SIGNATURE_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };

  const expected = createHmac("sha256", keyFrom(secret))
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest("base64");

  // The header may carry several space-separated versioned signatures during key rotation;
  // any one matching is a pass.
  const candidates = headers.signature.split(" ").map((s) => s.includes(",") ? s.split(",")[1] : s);
  for (const c of candidates) if (c && safeEqual(c, expected)) return { ok: true };

  return { ok: false, reason: "bad_signature" };
}

/** Events that change access. Anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = [
  "subscription.created",
  "subscription.active",
  "subscription.updated",
  "subscription.canceled",
  "subscription.revoked",
  "subscription.uncanceled",
] as const;

export function isHandled(eventType: string): boolean {
  return (HANDLED_EVENTS as readonly string[]).includes(eventType);
}

/**
 * Pull what we need out of a subscription event, defensively.
 *
 * The provider owns this shape and may add to it. Reading a handful of fields by name and
 * ignoring the rest means a payload change adds a field rather than breaking billing.
 */
export type ParsedEvent = {
  externalId: string;
  status: string;
  currentPeriodEnd: number | null;
  productId: string | null;
  /** Our user id, passed through at checkout. See the note in the route. */
  userId: string | null;
  customerEmail: string | null;
};

export function parseSubscriptionEvent(payload: unknown): ParsedEvent | null {
  const root = payload as Record<string, unknown> | null;
  const data = (root?.data ?? root) as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return null;

  const externalId = typeof data.id === "string" ? data.id : "";
  if (!externalId) return null;

  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const customer = (data.customer ?? {}) as Record<string, unknown>;
  const product = (data.product ?? {}) as Record<string, unknown>;

  const endRaw = data.current_period_end ?? data.currentPeriodEnd ?? data.ends_at;
  const end = typeof endRaw === "string" || typeof endRaw === "number" ? new Date(endRaw).getTime() : NaN;

  return {
    externalId,
    status: typeof data.status === "string" ? data.status : "",
    currentPeriodEnd: Number.isFinite(end) ? end : null,
    productId: typeof data.product_id === "string" ? data.product_id
      : typeof product.id === "string" ? product.id : null,
    // Checkout must carry our user id in metadata. Matching on email instead is a security
    // problem: two accounts can share an address, and email is not proof of anything.
    userId: typeof metadata.user_id === "string" ? metadata.user_id
      : typeof metadata.userId === "string" ? metadata.userId : null,
    customerEmail: typeof customer.email === "string" ? customer.email : null,
  };
}
