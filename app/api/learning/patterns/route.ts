import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaceKey } from "@/lib/intel";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { learningEngine } from "@/lib/learning/shared";
import { PATTERN_KINDS, type PatternKind } from "@/lib/learning/types";

export const runtime = "nodejs";

// Pattern Library — search learned winning patterns (hooks/stories/CTAs/headlines/layouts/
// motion/UGC/video/image styles/launch sequences/posting times).
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const p = req.nextUrl.searchParams;
  const kind = p.get("kind");
  // Scoped to the caller's workspace. This route used to search every pattern in the
  // database and return the best, whoever they belonged to.
  const key = (await workspaceKey(p.get("wsid"))) ?? "default";
  const patterns = await learningEngine(db()).patterns.search(key, {
    kind: kind && (PATTERN_KINDS as readonly string[]).includes(kind) ? (kind as PatternKind) : undefined,
    platform: p.get("platform") || undefined,
    audience: p.get("audience") || undefined,
    industry: p.get("industry") || undefined,
  }, Math.min(50, Number(p.get("limit")) || 20));
  return NextResponse.json({ ok: true, kinds: PATTERN_KINDS, patterns });
}
