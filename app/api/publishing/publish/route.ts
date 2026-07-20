import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { getPublishingRegistry, PublishingRouter, platformFor, NeonHistoryStore } from "@/lib/publishing";
import { PLATFORMS, type PlatformId, type PublishTarget } from "@/lib/publishing/types";
import { ASSET_KINDS, type AssetKind } from "@/lib/creative/taxonomy";

export const runtime = "nodejs";

// Publish an asset through the router (provider selection + retry + fallback). Platform
// is resolved from the asset kind when not given. Publishing goes through the router; it
// never touches a platform directly, and history is recorded.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 8, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const assetKey = String(body.assetKey || "");
  const content = String(body.content || "");
  if (!assetKey || !content) return NextResponse.json({ error: "missing_fields", hint: "assetKey + content required" }, { status: 422 });

  const kind = String(body.kind || "");
  let platform = String(body.platform || "") as PlatformId;
  if (!(PLATFORMS as readonly string[]).includes(platform)) {
    platform = platformFor((ASSET_KINDS as readonly string[]).includes(kind) ? (kind as AssetKind) : "blog", body.channel as string | undefined);
  }

  const target: PublishTarget = {
    assetKey, platform, content,
    mediaRefs: Array.isArray(body.mediaRefs) ? (body.mediaRefs as string[]) : undefined,
    title: body.title as string | undefined,
    scheduledAt: typeof body.scheduledAt === "number" ? body.scheduledAt : undefined,
  };

  const router = new PublishingRouter(getPublishingRegistry(), { now: () => Date.now() });
  const result = await router.publish(target);

  // Persist history when a database is available (best-effort).
  const sql = db();
  if (sql) { try { for (const r of router.history()) await new NeonHistoryStore(sql).record(r); } catch { /* best-effort */ } }

  console.info(JSON.stringify({ event: "publishing_publish", assetKey, platform, status: result.status, fellBack: result.fellBack }));
  return NextResponse.json({ ok: result.ok, result });
}
