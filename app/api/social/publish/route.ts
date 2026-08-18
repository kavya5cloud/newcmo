import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requirePlan } from "@/lib/billing/gate";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { readAssets, readContent, readPlatform } from "@/lib/social/api-helpers";

export const runtime = "nodejs";

// Publish now to a connected account. Idempotent on idempotencyKey. Execution runs through
// the platform adapter only.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 6, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  // Publishing is part of the plan. Checked before the body is even read: a lapsed account
  // should get the same answer for a malformed request as a well-formed one.
  const denied = await requirePlan(session?.userId);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const platform = readPlatform(body.platform);
  const accountId = String(body.accountId || "");
  if (!platform || !accountId) return NextResponse.json({ error: "missing_fields", hint: "accountId + platform required" }, { status: 422 });
  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";

  const job = await socialEngine().publishNow({
    tenant, accountId, platform, content: readContent(body.content), assets: readAssets(body.assets),
    idempotencyKey: body.idempotencyKey as string | undefined,
  });
  return NextResponse.json({ ok: job.state === "published", job });
}
