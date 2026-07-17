import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey, logRecEvent, logContentAsset, REC_EVENTS, type RecEvent } from "@/lib/intel";

export const runtime = "nodejs";

// Append one lifecycle event for a recommendation (viewed/edited/drafted/approved/
// dismissed/scheduled/published/completed/expired). Optionally stores the produced
// deliverable body as a content asset (event=drafted).
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false });

  let body: {
    wsid?: string;
    recommendationId?: string;
    event?: string;
    metadata?: Record<string, unknown>;
    asset?: { title?: string; body?: string; channel?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const key = await workspaceKey(body.wsid ?? null);
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const event = String(body.event || "") as RecEvent;
  if (!REC_EVENTS.includes(event) || event === "generated") {
    return NextResponse.json({ error: "bad_event" }, { status: 400 });
  }
  const recId = String(body.recommendationId || "");
  if (!/^[0-9a-f-]{36}$/i.test(recId)) return NextResponse.json({ error: "bad_id" }, { status: 400 });

  const actor = session ? "user:" + session.userId : "anon";
  const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

  try {
    const ok = await logRecEvent(sql, key, recId, event, actor, metadata);
    if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (event === "drafted" && body.asset?.body && body.asset.title) {
      await logContentAsset(
        sql, key, recId,
        body.asset.channel ? String(body.asset.channel).slice(0, 40) : null,
        String(body.asset.title), String(body.asset.body)
      );
    }
    console.info(JSON.stringify({ event: "intel_rec_event", recId, transition: event, wsKey: key }));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.info(JSON.stringify({ event: "intel_event_error", detail: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "log_failed" }, { status: 502 });
  }
}
