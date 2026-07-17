import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { logAssetEvent } from "@/lib/services/assets";
import { ASSET_EVENTS, type AssetEvent } from "@/lib/services/asset-validate";

export const runtime = "nodejs";

// Asset lifecycle — the creative git history. edited/regenerated with a body create a
// NEW VERSION row (append-only); approve/reject/schedule/publish/archive move the
// chain's current status. Every transition is an asset_events row.

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ error: "no_database" }, { status: 503 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  let body: {
    wsid?: string;
    event?: string;
    body?: string;
    title?: string;
    structure?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const key = await workspaceKey(body.wsid ?? null);
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const event = String(body.event || "") as AssetEvent;
  if (!ASSET_EVENTS.includes(event) || event === "generated") {
    return NextResponse.json({ error: "bad_event" }, { status: 400 });
  }
  if ((event === "edited" || event === "regenerated") && !(typeof body.body === "string" && body.body.trim().length >= 20)) {
    return NextResponse.json({ error: "body_required", hint: "edits create a new version — send the new body" }, { status: 400 });
  }

  try {
    const actor = session ? "user:" + session.userId : "anon";
    const result = await logAssetEvent(sql, key, id, event, actor, {
      body: body.body?.slice(0, 50_000),
      title: body.title?.slice(0, 300),
      structure: body.structure && typeof body.structure === "object" ? body.structure : undefined,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
    });
    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
    console.info(JSON.stringify({ event: "asset_event", assetId: id, transition: event, newVersion: result.version || null, wsKey: key }));
    return NextResponse.json({ ok: true, id: result.id, version: result.version || undefined });
  } catch (e) {
    return NextResponse.json({ error: "log_failed", detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
