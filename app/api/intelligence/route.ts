import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { workspaceKey } from "@/lib/intel";
import { rateLimit, requestKey } from "@/lib/throttle";
import { referenceRepo } from "@/lib/intelligence/store";

export const runtime = "nodejs";

// The intelligence corpus, as the library page reads it.
//
// Scoped the way retrieval is scoped: the shared library plus anything private to this
// workspace, and never another workspace's rows. That distinction is the whole reason this
// store exists separately from the Pattern Library, which did not have it.

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  const repo = referenceRepo();

  try {
    const [rows, counts] = await Promise.all([
      repo.browse(tenant, 200),
      repo.count(tenant),
    ]);
    return NextResponse.json({ ok: true, counts, references: rows });
  } catch {
    // An empty corpus and an unreachable one are different facts, and the page says which.
    return NextResponse.json({ error: "unavailable", hint: "The corpus could not be read." }, { status: 503 });
  }
}
