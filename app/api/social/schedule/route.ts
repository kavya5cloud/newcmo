import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { parseSchedule } from "@/lib/social/scheduler";
import { readAssets, readContent, readPlatform } from "@/lib/social/api-helpers";

export const runtime = "nodejs";

// Schedule a post. Time is a local wall-clock ("YYYY-MM-DDTHH:mm") interpreted in the
// given IANA timezone (DST-correct). The scheduler holds no platform logic; a worker
// dispatches it through the adapter when due.
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 6, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const platform = readPlatform(body.platform);
  const accountId = String(body.accountId || "");
  const timezone = String(body.timezone || "UTC");
  if (!platform || !accountId) return NextResponse.json({ error: "missing_fields" }, { status: 422 });

  const at = typeof body.at === "number" ? body.at : parseSchedule(String(body.at || ""), timezone);
  if (at == null || !Number.isFinite(at)) return NextResponse.json({ error: "invalid_time", hint: "at = epoch ms or 'YYYY-MM-DDTHH:mm' + timezone" }, { status: 422 });

  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  const job = await socialEngine().schedule({
    tenant, accountId, platform, content: readContent(body.content), assets: readAssets(body.assets),
    idempotencyKey: body.idempotencyKey as string | undefined,
  }, at, timezone);
  return NextResponse.json({ ok: true, job });
}
