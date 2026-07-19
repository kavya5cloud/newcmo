import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { normalizeBrief } from "@/lib/creative/pipeline";
import { ASSET_KINDS, type AssetKind } from "@/lib/creative/taxonomy";
import { buildScript } from "@/lib/creative-intelligence";

export const runtime = "nodejs";

// Script Engine API — produce a fully typed script (hook/opening/middle/cta/closing with
// timing, captions, voice notes and scene references). No free-form blobs. Deterministic.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 15, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const kind = String(body.assetType || "");
  if (!(ASSET_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "invalid_asset_type" }, { status: 422 });
  if (!body.brief || typeof body.brief !== "object") return NextResponse.json({ error: "missing_brief" }, { status: 422 });

  const script = buildScript(normalizeBrief(body.brief as Record<string, unknown>), kind as AssetKind);
  return NextResponse.json({ ok: true, script });
}
