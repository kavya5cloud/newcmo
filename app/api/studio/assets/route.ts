import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { validateAssetGraph } from "@/lib/services/asset-validate";
import { createAssetGraph, listAssets } from "@/lib/services/assets";
import { ensureCampaignTables } from "@/lib/services/campaigns";

export const runtime = "nodejs";

// Content Studio API — assets exist only inside the decision chain.
// PRIME DIRECTIVE: no campaignId → 400 decision_required. Content cannot be
// created outside a campaign; that is what separates an OS from a toy.

async function ownsCampaign(sql: NonNullable<ReturnType<typeof db>>, wsKey: string, campaignId: string) {
  await ensureCampaignTables(sql);
  const rows = (await sql`
    SELECT 1 FROM campaigns WHERE id = ${campaignId} AND workspace_key = ${wsKey}`) as unknown[];
  return rows.length > 0;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 20 : 8, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ error: "no_database" }, { status: 503 });

  let body: { wsid?: string; campaignId?: string; assets?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const key = await workspaceKey(body.wsid ?? null);
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const campaignId = String(body.campaignId || "");
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
    return NextResponse.json(
      { error: "decision_required", hint: "assets can only be created inside a campaign" },
      { status: 400 }
    );
  }
  if (!(await ownsCampaign(sql, key, campaignId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const v = validateAssetGraph(body.assets);
  if (!v.ok) return NextResponse.json({ error: "invalid_assets", fields: v.errors }, { status: 422 });

  try {
    const actor = session ? "user:" + session.userId : "anon";
    const ids = await createAssetGraph(sql, key, campaignId, v.value, actor);
    console.info(JSON.stringify({ event: "asset_graph_created", campaignId, wsKey: key, count: v.value.length }));
    return NextResponse.json({ ok: true, ids });
  } catch (e) {
    console.info(JSON.stringify({ event: "asset_graph_error", detail: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "create_failed" }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 15, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false, assets: [] });

  const key = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });
  const campaignId = String(req.nextUrl.searchParams.get("campaignId") || "");
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return NextResponse.json({ error: "decision_required" }, { status: 400 });

  try {
    const assets = await listAssets(sql, key, campaignId);
    return NextResponse.json({ enabled: true, assets });
  } catch (e) {
    return NextResponse.json({ enabled: false, assets: [], error: String(e).slice(0, 150) }, { status: 502 });
  }
}
