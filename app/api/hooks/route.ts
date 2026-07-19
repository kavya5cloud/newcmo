import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { retrieveHooks, type HookQuery } from "@/lib/creative-intelligence";
import { HOOK_CATEGORIES } from "@/lib/creative-intelligence";
import type { CreativeChannel } from "@/lib/creative/taxonomy";

export const runtime = "nodejs";

// Hook Engine API — retrieve reusable, categorized hooks best-first. The Asset Planner /
// Spec Builder pull openers from here rather than inventing them. Deterministic.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const p = req.nextUrl.searchParams;
  const cat = p.get("category");
  const q: HookQuery = {
    category: cat && (HOOK_CATEGORIES as readonly string[]).includes(cat) ? (cat as HookQuery["category"]) : undefined,
    channel: (p.get("channel") as CreativeChannel) || undefined,
    audience: p.get("audience") || undefined,
    industry: p.get("industry") || undefined,
  };
  const hooks = retrieveHooks(q, undefined, Math.min(20, Number(p.get("limit")) || 5));
  return NextResponse.json({ ok: true, categories: HOOK_CATEGORIES, hooks });
}
