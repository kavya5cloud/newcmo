import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/social/types";
import { decideVersion, editVersion, generateUgc } from "@/lib/ugc/engine";
import { ugcRepo } from "@/lib/ugc/shared";
import {
  CREATOR_STYLES, UGC_FORMATS, VOICE_STYLES,
  type CreatorStyle, type UgcBrief, type UgcFormat, type VoiceStyle,
} from "@/lib/ugc/types";

export const runtime = "nodejs";

// UGC workflow: generate a package (hooks, scripts, versions, CTAs), edit it, approve a
// version, and hand an approved version to the existing Draft Manager so it flows into
// scheduling and publishing like any other post. No parallel publishing path.

function readBrief(body: Record<string, unknown>): UgcBrief | { error: string } {
  const format = String(body.format || "testimonial");
  if (!(UGC_FORMATS as readonly string[]).includes(format)) return { error: "invalid_format" };
  const creatorStyle = String(body.creatorStyle || "founder");
  if (!(CREATOR_STYLES as readonly string[]).includes(creatorStyle)) return { error: "invalid_creator_style" };
  const voiceStyle = String(body.voiceStyle || "conversational");
  if (!(VOICE_STYLES as readonly string[]).includes(voiceStyle)) return { error: "invalid_voice_style" };

  const product = String(body.product || "").trim();
  const audience = String(body.audience || "").trim();
  const outcome = String(body.outcome || "").trim();
  if (!product || !audience || !outcome) return { error: "missing_brief" };

  return {
    product: product.slice(0, 120), audience: audience.slice(0, 120), outcome: outcome.slice(0, 200),
    format: format as UgcFormat, creatorStyle: creatorStyle as CreatorStyle, voiceStyle: voiceStyle as VoiceStyle,
    objection: body.objection ? String(body.objection).slice(0, 200) : undefined,
    platform: body.platform ? String(body.platform) : undefined,
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  const id = req.nextUrl.searchParams.get("id");
  try {
    const repo = ugcRepo();
    if (id) {
      const pkg = await repo.get(tenant, id);
      return pkg ? NextResponse.json({ ok: true, package: pkg }) : NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, packages: await repo.list(tenant) });
  } catch (e) {
    return NextResponse.json({ error: "ugc_read_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 12, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  const op = String(body.op || "generate");
  const repo = ugcRepo();

  try {
    if (op === "generate") {
      const brief = readBrief(body);
      if ("error" in brief) return NextResponse.json(brief, { status: 422 });
      const pkg = generateUgc(tenant, brief, { versions: Number(body.versions) || 3 });
      await repo.save(pkg);
      return NextResponse.json({ ok: true, package: pkg });
    }

    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 422 });
    const existing = await repo.get(tenant, id);
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const versionId = String(body.versionId || "");

    if (op === "edit") {
      if (!versionId) return NextResponse.json({ error: "missing_versionId" }, { status: 422 });
      const next = editVersion(existing, versionId, {
        caption: body.caption == null ? undefined : String(body.caption).slice(0, 3000),
        scenes: Array.isArray(body.scenes) ? (body.scenes as { index: number; line?: string; visual?: string }[]) : undefined,
      });
      await repo.save(next);
      return NextResponse.json({ ok: true, package: next });
    }

    if (op === "approve" || op === "reject") {
      if (!versionId) return NextResponse.json({ error: "missing_versionId" }, { status: 422 });
      const next = decideVersion(existing, versionId, op === "approve" ? "approved" : "rejected");
      await repo.save(next);
      return NextResponse.json({ ok: true, package: next });
    }

    if (op === "to_draft") {
      // Approved UGC becomes an ordinary draft. From here it uses the same schedule,
      // publish, retry and approval paths as every other post — there is no second
      // publishing pipeline for video.
      const version = existing.versions.find((v) => v.id === versionId);
      if (!version) return NextResponse.json({ error: "version_not_found" }, { status: 404 });
      if (version.status !== "approved") {
        return NextResponse.json({ error: "not_approved", hint: "Approve the version before sending it to drafts." }, { status: 409 });
      }
      const platforms = (Array.isArray(body.platforms) ? body.platforms : [])
        .map(String)
        .filter((p): p is SocialPlatform => (SOCIAL_PLATFORMS as readonly string[]).includes(p));
      const draft = await socialEngine().createDraft(
        tenant,
        `UGC · ${existing.brief.product} · ${version.label}`,
        platforms,
        { text: `${version.caption}\n\n${version.hashtags.join(" ")}`, assetIds: [] },
      );
      return NextResponse.json({ ok: true, draft, message: "Sent to drafts — schedule or publish it from Cross-Post." });
    }

    return NextResponse.json({ error: "invalid_op", hint: "generate | edit | approve | reject | to_draft" }, { status: 422 });
  } catch (e) {
    return NextResponse.json({ error: "ugc_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
