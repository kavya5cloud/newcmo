import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { marketPlatform } from "@/lib/market/shared";
import { readQuery } from "@/lib/market/api-helpers";
import { MarketError } from "@/lib/market/types";

export const runtime = "nodejs";

// Business Graph viewer — the merged market graph (brand, products, audiences,
// competitors, keywords, trends, integrations). `?node=` returns one node's neighbourhood,
// which is what an agent needs rather than the whole graph.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 12, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const p = req.nextUrl.searchParams;
  const tenant = (await workspaceKey(p.get("wsid"))) ?? "default";
  const brand = p.get("brand") || "Populr";
  const query = readQuery({ terms: p.get("terms"), competitors: p.get("competitors"), industry: p.get("industry"), audience: p.get("audience") }, tenant);
  if (!query.terms.length && !query.industry) {
    return NextResponse.json({ error: "invalid_query", hint: "provide ?terms=a,b or ?industry=" }, { status: 422 });
  }

  const { research, graph } = marketPlatform();
  try {
    const brief = await research.run(query);
    const audiences = new (await import("@/lib/market/audience")).AudienceInsightService().analyze([]);
    const g = graph.build({
      tenant, brand,
      products: (p.get("products") || "").split(",").map((s) => s.trim()).filter(Boolean),
      competitors: brief.competitors,
      keywords: brief.keywords,
      trends: brief.trends,
      audiences,
      integrations: [...new Set(brief.trends.flatMap((t) => t.sources))],
    });

    const node = p.get("node");
    if (node) {
      if (!g.entities.some((e) => e.id === node)) return NextResponse.json({ error: "node_not_found" }, { status: 404 });
      return NextResponse.json({ ok: true, node, neighbours: graph.neighbours(g, node), version: g.version });
    }
    return NextResponse.json({ ok: true, graph: g });
  } catch (e) {
    if (e instanceof MarketError) return NextResponse.json({ error: e.reason, message: e.message }, { status: 422 });
    return NextResponse.json({ error: "graph_failed" }, { status: 502 });
  }
}
