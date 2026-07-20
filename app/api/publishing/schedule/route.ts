import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { getPublishingRegistry, PublishingRouter, platformFor } from "@/lib/publishing";
import { PLATFORMS, type PlatformId, type PublishTarget } from "@/lib/publishing/types";
import { ASSET_KINDS, type AssetKind } from "@/lib/creative/taxonomy";

export const runtime = "nodejs";

// Schedule an asset for future publishing via its platform provider.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 8, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const assetKey = String(body.assetKey || "");
  const content = String(body.content || "");
  const scheduledAt = Number(body.scheduledAt);
  if (!assetKey || !content || !Number.isFinite(scheduledAt)) {
    return NextResponse.json({ error: "missing_fields", hint: "assetKey + content + scheduledAt required" }, { status: 422 });
  }

  const kind = String(body.kind || "");
  let platform = String(body.platform || "") as PlatformId;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    platform = platformFor((ASSET_KINDS as readonly string[]).includes(kind) ? (kind as AssetKind) : "blog", body.channel as string | undefined);
  }

  const target: PublishTarget = { assetKey, platform, content, scheduledAt };
  const router = new PublishingRouter(getPublishingRegistry(), { now: () => Date.now() });
  const result = await router.schedule(target);
  return NextResponse.json({ ok: result.ok, result });
}
