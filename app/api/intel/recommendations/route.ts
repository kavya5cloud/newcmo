import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey, isSafePublicUrl } from "@/lib/throttle";
import { workspaceKey, logRecommendations, type RecInput } from "@/lib/intel";
import { CACHE_VERSION } from "@/lib/ai-cache";

export const runtime = "nodejs";

// Append a batch of generated recommendations to the intelligence dataset.
// Fire-and-forget from the client after feed generation; returns clientKey → UUID
// so later lifecycle events (drafted/approved/published) can reference them.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false });

  let body: {
    wsid?: string;
    url?: string;
    profile?: unknown;
    provider?: string;
    model?: string;
    items?: { channel?: string; title?: string; action?: string; clientKey?: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const key = await workspaceKey(body.wsid ?? null);
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });
  const url = String(body.url || "");
  if (!url || !isSafePublicUrl(url)) return NextResponse.json({ error: "bad_url" }, { status: 400 });

  const items: RecInput[] = (Array.isArray(body.items) ? body.items : [])
    .filter((it) => it && typeof it.title === "string" && it.title.trim() && typeof it.channel === "string")
    .slice(0, 50)
    .map((it) => ({
      channel: String(it.channel).slice(0, 40),
      title: String(it.title).trim(),
      actionLabel: it.action ? String(it.action).slice(0, 80) : undefined,
      clientKey: it.clientKey ? String(it.clientKey).slice(0, 120) : undefined,
    }));
  if (!items.length) return NextResponse.json({ error: "no_items" }, { status: 400 });

  try {
    const ids = await logRecommendations(sql, key, url, body.profile ?? {}, items, {
      provider: body.provider ? String(body.provider).slice(0, 40) : null,
      model: body.model ? String(body.model).slice(0, 80) : null,
      snapshotVersion: CACHE_VERSION,
    });
    console.info(JSON.stringify({ event: "intel_recommendations_logged", wsKey: key, url, count: items.length }));
    return NextResponse.json({ ok: true, ids });
  } catch (e) {
    console.info(JSON.stringify({ event: "intel_recommendations_error", detail: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "log_failed" }, { status: 502 });
  }
}
