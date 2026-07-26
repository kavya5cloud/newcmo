import { NextRequest, NextResponse } from "next/server";
import { socialEngine } from "@/lib/social/shared";
import { normalizeWebhook, verifySignature } from "@/lib/social/webhooks";
import { readPlatform } from "@/lib/social/api-helpers";

export const runtime = "nodejs";

// Platform webhook receiver. Verifies the HMAC signature, normalizes the payload, then
// lets the engine apply it. Signature verification is REQUIRED whenever
// SOCIAL_WEBHOOK_SECRET is configured — an unsigned/forged callback must never be able to
// mark posts published or disconnect accounts.
export async function POST(req: NextRequest, ctx: { params: Promise<{ platform: string }> }) {
  const { platform: raw } = await ctx.params;
  const platform = readPlatform(raw);
  if (!platform) return NextResponse.json({ error: "invalid_platform" }, { status: 404 });

  // Read the raw body so the signature is checked against exact bytes.
  const body = await req.text();
  const sig = req.headers.get("x-populr-signature") ?? req.headers.get("x-hub-signature-256");
  const { ok, configured } = verifySignature(body, sig);
  if (configured && !ok) {
    console.info(JSON.stringify({ event: "social_webhook_rejected", platform, reason: "bad_signature" }));
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }
  if (!configured) {
    // Fail closed in production; allow locally so the flow is testable without a secret.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "webhooks_not_configured" }, { status: 503 });
    }
  }

  let payload: Record<string, unknown>;
  try { payload = JSON.parse(body); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const event = normalizeWebhook(platform, payload, Date.now());
  const result = await socialEngine().applyWebhook(event);
  return NextResponse.json({ ok: true, event: event.type, ...result });
}
