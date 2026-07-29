import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { assembleBrief } from "@/lib/brief/assemble";
import { writeSummary } from "@/lib/brief/summary";
import { isFresh, readCache, writeCache, invalidate } from "@/lib/brief/cache";

export const runtime = "nodejs";

// The Daily Brief.
//
// Assembly is cheap enough to always run — it is reads against engines that are already
// warm — and it produces the fingerprint the cache is keyed on. The expensive part is the
// model call for the summary, so that is what the cache actually saves: if the world has
// not changed, yesterday's sentence is still true and is reused.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  const now = Date.now();
  const force = req.nextUrl.searchParams.get("refresh") === "1";
  if (force) invalidate(tenant);

  try {
    const brief = await assembleBrief({
      tenant, now,
      company: req.nextUrl.searchParams.get("company") ?? undefined,
    });

    const hit = readCache(tenant, now);
    if (!force && isFresh(hit, brief.signature, now)) {
      // Same world, same words — but the sections are the ones just assembled, so nothing
      // shown is older than this request.
      return NextResponse.json({
        ok: true, cached: true,
        brief: { ...brief, summary: hit!.brief.summary, summarySource: hit!.brief.summarySource },
      });
    }

    const { summary, source } = await writeSummary(brief);
    const full = { ...brief, summary, summarySource: source };
    writeCache(tenant, full, now);
    return NextResponse.json({ ok: true, cached: false, brief: full });
  } catch (e) {
    return NextResponse.json({ error: "brief_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
