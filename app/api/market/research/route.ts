import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { marketPlatform } from "@/lib/market/shared";
import { remember } from "@/lib/market/memory";
import { readQuery } from "@/lib/market/api-helpers";
import { MarketError } from "@/lib/market/types";
import { jobEngine } from "@/lib/jobs/shared";

export const runtime = "nodejs";

// Run a research pass. `background: true` enqueues it on the EXISTING Job Engine (M11)
// rather than introducing a second orchestration layer — poll /api/jobs/{id} for progress.
// Otherwise it runs inline and returns the brief. Results are written to Market Memory.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 20 : 5, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  const query = readQuery(body, tenant);
  if (!query.terms.length && !query.industry) {
    return NextResponse.json({ error: "invalid_query", hint: "provide terms[] or an industry" }, { status: 422 });
  }

  // Background collection through the Job Engine.
  if (body.background) {
    const job = jobEngine().createJob("market_research", {
      requestType: "strategy", workspaceKey: tenant,
      payload: { terms: query.terms, competitors: query.competitors ?? [], industry: query.industry },
    }, { priority: "low" });
    void jobEngine().drain();
    return NextResponse.json({ ok: true, background: true, jobId: job.id });
  }

  const { research, memory } = marketPlatform();
  try {
    const brief = await research.run(query, { withNarrative: !!body.withNarrative });
    const stored = await remember(memory, tenant, brief.generatedAt, {
      trends: brief.trends, competitors: brief.competitors, opportunities: brief.opportunities,
    });
    return NextResponse.json({ ok: true, brief, remembered: stored });
  } catch (e) {
    if (e instanceof MarketError) {
      return NextResponse.json({ error: e.reason, message: e.message, source: e.source }, { status: e.reason === "rate_limited" ? 429 : 422 });
    }
    console.info(JSON.stringify({ event: "market_research_error", detail: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "research_failed" }, { status: 502 });
  }
}
