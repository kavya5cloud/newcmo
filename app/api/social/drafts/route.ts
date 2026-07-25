import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { readContent, readPlatform } from "@/lib/social/api-helpers";
import type { SocialPlatform } from "@/lib/social/types";

export const runtime = "nodejs";

// Draft list (GET) + create (POST).
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  return NextResponse.json({ ok: true, drafts: await socialEngine().listDrafts(tenant) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 12, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  const platforms = (Array.isArray(body.platforms) ? body.platforms.map(readPlatform).filter(Boolean) : []) as SocialPlatform[];
  const draft = await socialEngine().createDraft(tenant, String(body.title || "Untitled"), platforms, readContent(body.content));
  return NextResponse.json({ ok: true, draft });
}
