import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { logCampaignEvent } from "@/lib/services/campaigns";
import { CAMPAIGN_EVENTS, type CampaignEvent } from "@/lib/services/contracts";

export const runtime = "nodejs";

// Campaign lifecycle transitions: activated | paused | completed | task_done | archived.
// task_done carries { taskIndex } metadata; task recommendations get their own
// 'completed' event via /api/intel/events (client fires both).

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

  let body: { wsid?: string; event?: string; metadata?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const key = await workspaceKey(body.wsid ?? null);
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const event = String(body.event || "") as CampaignEvent;
  if (!CAMPAIGN_EVENTS.includes(event) || event === "created") {
    return NextResponse.json({ error: "bad_event" }, { status: 400 });
  }

  try {
    const actor = session ? "user:" + session.userId : "anon";
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const ok = await logCampaignEvent(sql, key, id, event, actor, metadata);
    if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    console.info(JSON.stringify({ event: "campaign_event", campaignId: id, transition: event, wsKey: key }));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "log_failed", detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
