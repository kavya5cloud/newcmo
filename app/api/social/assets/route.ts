import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import {
  createAsset, isSupportedMime, validateForPlatform,
  InMemoryAssetStore, NeonAssetStore, type AssetStore,
} from "@/lib/social/assets";
import { readPlatform } from "@/lib/social/api-helpers";

export const runtime = "nodejs";

const memStore = new InMemoryAssetStore();
function store(): AssetStore {
  const sql = db();
  return sql ? new NeonAssetStore(sql) : memStore;
}

// Media library for posts. GET lists a tenant's assets; POST registers one (and can
// validate it against a target platform's constraints before it's ever scheduled).
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  return NextResponse.json({ ok: true, assets: await store().list(tenant) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const uri = String(body.uri || "");
  const mime = String(body.mime || "");
  if (!uri || !mime) return NextResponse.json({ error: "missing_fields", hint: "uri + mime required" }, { status: 422 });
  if (!isSupportedMime(mime)) return NextResponse.json({ error: "unsupported_media_type", mime }, { status: 415 });

  const asset = createAsset({
    uri, mime,
    altText: body.altText as string | undefined,
    width: typeof body.width === "number" ? body.width : undefined,
    height: typeof body.height === "number" ? body.height : undefined,
  });

  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  await store().save(tenant, asset);

  // Optional pre-flight check against a platform's rules.
  const platform = readPlatform(body.platform);
  const validation = platform ? validateForPlatform([asset], platform) : null;
  return NextResponse.json({ ok: true, asset, validation });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 422 });
  await store().remove(id);
  return NextResponse.json({ ok: true });
}
