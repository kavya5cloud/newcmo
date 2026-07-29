import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { createAdapterRegistry, liveAdapterPlatforms } from "@/lib/social/registry";

export const runtime = "nodejs";

// Connected accounts for a tenant, plus the platforms available to connect.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  const accounts = await socialEngine().listAccounts(tenant);

  // `live` is the difference between a post that reaches LinkedIn and one that is recorded
  // as published and goes nowhere. The UI has to be able to say which it is, so it ships
  // with the constraints rather than being inferred somewhere else.
  const live = new Set(liveAdapterPlatforms());
  const platforms = createAdapterRegistry().list().map((a) => ({
    ...a.constraints(),
    live: live.has(a.platform),
  }));

  return NextResponse.json({ ok: true, accounts, platforms, liveMode: live.size > 0 });
}
