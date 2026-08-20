import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { generateInsights } from "@/lib/learning";
import { learningEngine, feedbackStore } from "@/lib/learning/shared";

export const runtime = "nodejs";

// Learning Insights — the ranked feed generated from the current learned state (patterns,
// brand DNA, decision accuracy). Deterministic.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const key = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  const sql = db();
  const engine = learningEngine(sql);
  const patterns = await engine.patterns.all(key);
  const brand = await engine.brand.latest(key);
  const accuracy = await feedbackStore(sql).accuracy();
  const insights = generateInsights({ aggregates: [], patterns, brand, accuracy });
  return NextResponse.json({ ok: true, insights, accuracy });
}
