import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isSafePublicUrl, rateLimit, requestKey } from "@/lib/throttle";
import { auditUrl } from "@/lib/seo/audit";

export const runtime = "nodejs";
// Two Lighthouse runs against a cold URL routinely take 20–40s. Anything less returns a
// timeout that reads to the user as "the audit failed" when it was only slow.
export const maxDuration = 90;

// GET /api/seo/audit?url=…
//
// The audit is expensive — two Lighthouse runs plus a page fetch — and the result changes on
// the timescale of a deploy, not a request. So it is cached in memory per URL, which is
// enough: an instance serves one person's repeated tab-switching, and a cold instance simply
// measures again.
//
// isSafePublicUrl is not optional here. This route takes a URL from the client and fetches
// it server-side, which is the exact shape of an SSRF: without the check, `?url=http://
// 169.254.169.254/…` would have the server read its own cloud metadata and hand it back.

const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

export async function GET(req: NextRequest) {
  const session = await getSession();
  // Audits cost real time on Google's side; anonymous callers get a much smaller allowance.
  const limit = rateLimit(`seoaudit:${requestKey(req.headers, session?.userId)}`, session ? 10 : 3, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", hint: `Too many audits. Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const raw = new URL(req.url).searchParams.get("url")?.trim() ?? "";
  if (!raw) return NextResponse.json({ error: "missing_url", hint: "Pass ?url= a public http(s) address." }, { status: 400 });
  if (!isSafePublicUrl(raw)) {
    return NextResponse.json({ error: "unsafe_url", hint: "Use a public http(s) website URL." }, { status: 400 });
  }

  const hit = cache.get(raw);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return NextResponse.json({ ok: true, cached: true, audit: hit.data }, { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const audit = await auditUrl(raw, { timeoutMs: 75_000 });
    cache.set(raw, { at: Date.now(), data: audit });
    // Logged with the problems array so a partial audit is visible in production without
    // anyone having to reproduce it.
    console.info(JSON.stringify({ event: "seo_audit", url: raw, problems: audit.problems, issues: audit.issues.length }));
    return NextResponse.json({ ok: true, cached: false, audit }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ event: "seo_audit_failed", url: raw, detail: String(e).slice(0, 200) }));
    return NextResponse.json(
      { error: "audit_failed", hint: "The audit could not complete. It is usually a timeout — try again." },
      { status: 503 },
    );
  }
}
