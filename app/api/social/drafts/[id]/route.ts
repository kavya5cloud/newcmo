import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { socialEngine } from "@/lib/social/shared";
import { readContent, readPlatform } from "@/lib/social/api-helpers";
import type { SocialPlatform } from "@/lib/social/types";

export const runtime = "nodejs";

// Draft read / update / delete.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const draft = await socialEngine().getDraft(id);
  return draft ? NextResponse.json({ ok: true, draft }) : NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 12, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title;
  if (Array.isArray(body.platforms)) patch.platforms = body.platforms.map(readPlatform).filter(Boolean) as SocialPlatform[];
  if (body.content) patch.content = readContent(body.content);
  const draft = await socialEngine().updateDraft(id, patch);
  return draft ? NextResponse.json({ ok: true, draft }) : NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await socialEngine().deleteDraft(id);
  return NextResponse.json({ ok: true });
}
