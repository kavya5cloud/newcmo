import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { socialEngine } from "@/lib/social/shared";

export const runtime = "nodejs";

// retry a publishing job.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 8, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const jobId = String(body.jobId || "");
  if (!jobId) return NextResponse.json({ error: "missing_job" }, { status: 422 });
  const out = await socialEngine().retry(jobId);
  return NextResponse.json({ ok: !!out, job: out ?? null });
}
