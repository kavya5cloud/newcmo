import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { marketPlatform } from "@/lib/market/shared";
import { readQuery, readPaging } from "@/lib/market/api-helpers";
import { paginate, MarketError } from "@/lib/market/types";

export const runtime = "nodejs";

// Competitor dashboard — profiles + summaries.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 12, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const p = req.nextUrl.searchParams;
  const tenant = (await workspaceKey(p.get("wsid"))) ?? "default";
  const query = readQuery({ terms: p.get("terms"), competitors: p.get("competitors"), industry: p.get("industry"), audience: p.get("audience") }, tenant);
  if (!query.terms.length && !query.industry) {
    return NextResponse.json({ error: "invalid_query", hint: "provide ?terms=a,b or ?industry=" }, { status: 422 });
  }

  const { research } = marketPlatform();
  try {
    const brief = await research.run(query);
    const { offset, limit: lim } = readPaging(p);
    return NextResponse.json({ ok: true, ...paginate(brief.competitors, offset, lim) });
  } catch (e) {
    if (e instanceof MarketError) return NextResponse.json({ error: e.reason, message: e.message }, { status: 422 });
    return NextResponse.json({ error: "failed" }, { status: 502 });
  }
}
