import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { createExperiment, runExperiment, EXPERIMENT_TYPES } from "@/lib/publishing";
import type { ExperimentType } from "@/lib/launch/types";

export const runtime = "nodejs";

// Experiment Engine — A/B and variant tests (headline/hook/thumbnail/caption/cta/variant)
// linked to an asset/campaign/mission. Records hypothesis, variants, results, winner,
// confidence. Deterministic winner selection (reuses the Milestone 7 engine).
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 15, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const type = String(body.type || "") as ExperimentType;
  if (!(EXPERIMENT_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: "invalid_type", hint: EXPERIMENT_TYPES.join(", ") }, { status: 422 });
  }
  const variants = Array.isArray(body.variants) ? (body.variants as { id: string; label: string }[]) : [];
  if (variants.length < 2) return NextResponse.json({ error: "need_2_variants" }, { status: 422 });

  try {
    const exp = createExperiment({
      id: String(body.id || `exp_${Date.now()}`),
      type,
      hypothesis: String(body.hypothesis || ""),
      variants: variants.map((v) => ({ id: String(v.id), label: String(v.label) })),
      assetKey: (body.assetKey as string) ?? null,
    });
    const results = Array.isArray(body.results) ? (body.results as { variantId: string; metric: number }[]) : [];
    const decided = results.length ? runExperiment(exp, results, { minConfidence: Number(body.minConfidence) || 0.05 }) : exp;
    return NextResponse.json({
      ok: true,
      experiment: decided,
      // echo linkage the caller supplied (campaign/mission) so the record is self-describing
      links: { assetKey: exp.assetKey, campaignId: body.campaignId ?? null, missionId: body.missionId ?? null },
    });
  } catch (e) {
    return NextResponse.json({ error: "experiment_failed", detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
