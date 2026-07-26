import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { marketPlatform } from "@/lib/market/shared";
import { seasonality } from "@/lib/market/memory";
import { readPaging } from "@/lib/market/api-helpers";
import { MEMORY_RECORD_KINDS, paginate, type MemoryRecordKind } from "@/lib/market/types";

export const runtime = "nodejs";

// Market Memory — historical trends, competitor history, campaigns, audiences,
// seasonality and past opportunities. `?key=` returns one subject's full history plus its
// seasonality profile.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const p = req.nextUrl.searchParams;
  const tenant = (await workspaceKey(p.get("wsid"))) ?? "default";
  const { memory } = marketPlatform();

  const key = p.get("key");
  if (key) {
    const history = await memory.history(tenant, key);
    return NextResponse.json({ ok: true, key, history, seasonality: seasonality(history) });
  }

  const kindParam = p.get("kind");
  const kind = kindParam && (MEMORY_RECORD_KINDS as readonly string[]).includes(kindParam)
    ? (kindParam as MemoryRecordKind) : undefined;

  const rows = await memory.list(tenant, kind, 500);
  const { offset, limit: lim } = readPaging(p);
  return NextResponse.json({ ok: true, kinds: MEMORY_RECORD_KINDS, ...paginate(rows, offset, lim) });
}
