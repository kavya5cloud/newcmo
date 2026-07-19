import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { validateSpecification } from "@/lib/creative-intelligence";
import type { GenerationSpecification } from "@/lib/creative-intelligence";

export const runtime = "nodejs";

// Validate a GenerationSpecification before it is allowed near a provider. Rejects
// incomplete specs (brand rules, missing fields, dependencies, character refs, story
// and visual completeness). Deterministic.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: { spec?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  if (!body.spec || typeof body.spec !== "object") return NextResponse.json({ error: "missing_spec" }, { status: 422 });

  const validation = validateSpecification(body.spec as GenerationSpecification);
  return NextResponse.json({ ok: true, validation });
}
