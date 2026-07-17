import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { rankChannels } from "@/lib/services/decisions";

export const runtime = "nodejs";

// Decision engine v1 — "what should this company do next?", answered from data
// instead of asking an LLM. Ranking logic lives in lib/services/decisions.ts and is
// shared with the Campaign Planner (decide first, then plan, then generate).

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false, ranking: [] });

  const key = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });

  try {
    const ranking = await rankChannels(sql, key);
    return NextResponse.json({ enabled: true, ranking });
  } catch (e) {
    return NextResponse.json({ enabled: false, ranking: [], error: String(e).slice(0, 150) }, { status: 502 });
  }
}
