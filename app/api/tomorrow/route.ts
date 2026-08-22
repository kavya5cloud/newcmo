import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { workspaceKey } from "@/lib/intel";
import { rateLimit, requestKey } from "@/lib/throttle";
import { automationRepo } from "@/lib/automation/shared";
import { liveAdapterPlatforms } from "@/lib/social/registry";
import { assembleTomorrow, tomorrowHeadline, tomorrowWindow } from "@/lib/tomorrow/assemble";
import { assessAutopilot } from "@/lib/autopilot/readiness";
import { lastHeartbeat } from "@/lib/autopilot/heartbeat";
import { accessForUser } from "@/lib/billing/gate";
import { assistantStore } from "@/lib/assistant/shared";
import { socialEngine } from "@/lib/social/shared";

export const runtime = "nodejs";

// Tomorrow: read it, then approve it. Two verbs, because there are only two things a
// founder should have to do with a plan their CMO already made.

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  // The viewer's own day, not UTC. Sent by the browser because the server cannot know it.
  const tz = Number(req.nextUrl.searchParams.get("tz"));
  const tzOffset = Number.isFinite(tz) ? Math.max(-840, Math.min(840, tz)) : 0;

  try {
    const now = Date.now();
    const live = liveAdapterPlatforms();

    // Why nothing will publish, assembled beside what will. Separating them would put the
    // plan on one screen and the reason it cannot run on another, which is the shape of
    // problem this page exists to end.
    const [t, settings, automations, accounts, heartbeat, access] = await Promise.all([
      assembleTomorrow(tenant, now, { livePlatforms: new Set(live) }, tzOffset),
      assistantStore().get(tenant).catch(() => null),
      automationRepo().listAutomations(tenant).catch(() => []),
      socialEngine().listAccounts(tenant).catch(() => []),
      lastHeartbeat().catch(() => null),
      session ? accessForUser(session.userId).catch(() => null) : Promise.resolve(null),
    ]);

    const readiness = assessAutopilot({
      // No session is a demo, not a lapsed customer. accessForUser already fails open for
      // the same reason; treating an anonymous viewer as unpaid would put a subscribe
      // prompt in front of someone who has not been asked to sign in yet.
      hasPlan: access ? access.allowed : true,
      settings, automations,
      connectedPlatforms: accounts.filter((a) => a.status === "connected").map((a) => a.platform),
      livePlatforms: live,
      heartbeat, now,
    });

    return NextResponse.json({ ok: true, tomorrow: t, headline: tomorrowHeadline(t), readiness });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

/**
 * Approve tomorrow, or drop one slot from it.
 *
 * Approving releases every slot waiting on a human. Dropping cancels one. There is
 * deliberately no "edit the plan" verb here: a founder who wants to rewrite tomorrow has
 * the Team screen, and putting a second planning surface behind the approve button is how
 * this page becomes the control panel it exists to replace.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const limit = rateLimit(requestKey(req.headers, session.userId), 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const action = String(body.action || "");
  if (action !== "approve" && action !== "skip") {
    return NextResponse.json({ error: "invalid_action", hint: "approve | skip" }, { status: 422 });
  }

  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  const tz = Number(body.tz);
  const tzOffset = Number.isFinite(tz) ? Math.max(-840, Math.min(840, tz)) : 0;
  const { from, to } = tomorrowWindow(Date.now(), tzOffset);

  const repo = automationRepo();
  const queue = await repo.listQueue(tenant).catch(() => []);

  if (action === "skip") {
    const id = String(body.id || "");
    const item = queue.find((q) => q.id === id);
    // Scoped to tomorrow's window on purpose: this endpoint's whole contract is one day, and
    // an id from a caller is not a licence to cancel an arbitrary future slot.
    if (!item || item.at < from || item.at >= to) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    await repo.saveQueue([{ ...item, state: "cancelled" }]);
    return NextResponse.json({ ok: true, skipped: id });
  }

  const waiting = queue.filter((q) => q.at >= from && q.at < to && q.state === "waiting_approval");
  if (waiting.length) await repo.saveQueue(waiting.map((q) => ({ ...q, state: "upcoming" as const })));
  return NextResponse.json({ ok: true, approved: waiting.length });
}
