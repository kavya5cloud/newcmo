import { createHmac, timingSafeEqual } from "node:crypto";
import type { SocialPlatform } from "./types";

// Webhook Service — receives platform callbacks (publish confirmed/failed, post deleted,
// token revoked) and normalizes them into ONE internal shape. Platform specifics stop
// here: the engine only ever sees a normalized WebhookEvent, exactly like adapters keep
// platform detail out of the scheduler.

export const WEBHOOK_EVENTS = [
  "publish.confirmed", "publish.failed", "post.deleted", "token.revoked", "unknown",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export type WebhookEvent = {
  platform: SocialPlatform;
  type: WebhookEventType;
  /** Provider post id, when the callback concerns a published post. */
  externalId: string | null;
  /** Provider account id, when the callback concerns an account/token. */
  accountExternalId: string | null;
  permalink: string | null;
  error: string | null;
  at: number;
  raw: Record<string, unknown>;
};

/**
 * Verify an HMAC-SHA256 webhook signature in constant time.
 * Secret comes from SOCIAL_WEBHOOK_SECRET. When no secret is configured we do NOT
 * silently accept — callers decide; `configured` tells them which case they're in.
 */
export function verifySignature(rawBody: string, signature: string | null): { ok: boolean; configured: boolean } {
  const secret = process.env.SOCIAL_WEBHOOK_SECRET;
  if (!secret) return { ok: false, configured: false };
  if (!signature) return { ok: false, configured: true };
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Strip common "sha256=" prefixes providers use.
  const provided = signature.replace(/^sha256=/i, "").trim();
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return { ok: false, configured: true };
  return { ok: timingSafeEqual(a, b), configured: true };
}

// Per-platform event-name aliases → our normalized type. Real providers each use their
// own vocabulary; this table is the only place that knows the difference.
const EVENT_ALIASES: Record<string, WebhookEventType> = {
  published: "publish.confirmed", post_published: "publish.confirmed", success: "publish.confirmed",
  "publish.confirmed": "publish.confirmed", media_published: "publish.confirmed",
  failed: "publish.failed", error: "publish.failed", publish_failed: "publish.failed",
  "publish.failed": "publish.failed",
  deleted: "post.deleted", post_deleted: "post.deleted", "post.deleted": "post.deleted",
  revoked: "token.revoked", token_revoked: "token.revoked", deauthorize: "token.revoked",
  "token.revoked": "token.revoked",
};

function pick(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/** Normalize any platform payload into a WebhookEvent. Pure + deterministic. */
export function normalizeWebhook(platform: SocialPlatform, payload: Record<string, unknown>, at = 0): WebhookEvent {
  const rawType = String(payload.event ?? payload.type ?? payload.status ?? "").toLowerCase();
  const type = EVENT_ALIASES[rawType] ?? "unknown";
  const data = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;

  return {
    platform,
    type,
    externalId: pick(data, ["externalId", "post_id", "postId", "id", "media_id"]),
    accountExternalId: pick(data, ["accountId", "account_id", "user_id", "page_id"]),
    permalink: pick(data, ["permalink", "url", "link"]),
    error: pick(data, ["error", "message", "reason"]),
    at: typeof payload.at === "number" ? payload.at : at,
    raw: payload,
  };
}
