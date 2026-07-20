import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { NeonHistoryStore } from "@/lib/publishing";

export const runtime = "nodejs";

// Publishing History — the durable log of publish attempts (provider, platform, retries,
// failures, rollback, URLs, metrics placeholder). Empty when no database is configured.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const sql = db();
  if (!sql) return NextResponse.json({ ok: true, records: [], enabled: false });
  const assetKey = req.nextUrl.searchParams.get("assetKey") || undefined;
  try {
    const records = await new NeonHistoryStore(sql).list(assetKey);
    return NextResponse.json({ ok: true, records, enabled: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "history_failed", detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
