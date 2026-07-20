import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { getPublishingRegistry } from "@/lib/publishing";

export const runtime = "nodejs";

// Platform providers + health (Part 10 "Platform Health"). Providers are adapters; this
// lists what the registry currently knows and each one's health.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const registry = getPublishingRegistry();
  const health = await registry.health();
  const providers = registry.list().map((p) => ({ platform: p.platform, version: p.version }));
  return NextResponse.json({ ok: true, providers, health });
}
