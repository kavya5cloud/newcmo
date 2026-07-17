import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey, isSafePublicUrl } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { validateCampaignInput } from "@/lib/services/campaign-validate";
import { createCampaign, listCampaigns } from "@/lib/services/campaigns";

export const runtime = "nodejs";

// Campaign Planner API. The client orchestrates: decision ranking (/api/intel/next)
// → LLM plan (/api/generate) → THIS route validates the shape and persists it.
// Nothing enters the database that fails the creative-brief contract.

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 15 : 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ error: "no_database" }, { status: 503 });

  let body: { wsid?: string; url?: string; profile?: unknown; campaign?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const key = await workspaceKey(body.wsid ?? null);
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });
  const url = String(body.url || "");
  if (!url || !isSafePublicUrl(url)) return NextResponse.json({ error: "bad_url" }, { status: 400 });

  const v = validateCampaignInput(body.campaign);
  if (!v.ok) return NextResponse.json({ error: "invalid_campaign", fields: v.errors }, { status: 422 });

  try {
    const actor = session ? "user:" + session.userId : "anon";
    const { id, tasks } = await createCampaign(sql, key, url, body.profile ?? {}, v.value, actor);
    console.info(JSON.stringify({ event: "campaign_created", campaignId: id, wsKey: key, goal: v.value.goal, tasks: tasks.length }));
    return NextResponse.json({ ok: true, id, tasks });
  } catch (e) {
    console.info(JSON.stringify({ event: "campaign_create_error", detail: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "create_failed" }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false, campaigns: [] });

  const key = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  try {
    const campaigns = await listCampaigns(sql, key);
    return NextResponse.json({ enabled: true, campaigns });
  } catch (e) {
    return NextResponse.json({ enabled: false, campaigns: [], error: String(e).slice(0, 150) }, { status: 502 });
  }
}
