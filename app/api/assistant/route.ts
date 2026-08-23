import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { automationRepo } from "@/lib/automation/shared";
import { createAutomations, materialize } from "@/lib/automation/engine";
import { latestResult } from "@/lib/results/headline";
import { assistantStore } from "@/lib/assistant/shared";
import { buildStatus } from "@/lib/assistant/status";
import { planFor } from "@/lib/assistant/plan";
import { ADVANCED_DEFAULTS, CADENCES, CONTROL_LEVELS, GOALS, PLATFORM_CHOICES } from "@/lib/assistant/types";
import type { AssistantSetup } from "@/lib/assistant/types";
import type { SocialPlatform } from "@/lib/social/types";
import type { Automation } from "@/lib/automation/types";

export const runtime = "nodejs";

// The Marketing Assistant's only endpoint.
//
// GET  — the four facts the status screen shows.
// POST — save the four answers and set the marketing running, or pause/resume it.
//
// Everything the engine needs is derived here from the answers. The client never sends a
// release mode, a content source or a recurrence, because the user is never asked for one.

const VALID_PLATFORMS = new Set(PLATFORM_CHOICES.map((p) => p.platform));

function readSetup(body: Record<string, unknown>): AssistantSetup | { error: string } {
  const cadence = String(body.cadence ?? "");
  if (!(CADENCES as readonly string[]).includes(cadence)) return { error: "Pick how often to post." };

  const control = String(body.control ?? "");
  if (!(CONTROL_LEVELS as readonly string[]).includes(control)) return { error: "Pick how much you want to review." };

  const goal = String(body.goal ?? "");
  if (!(GOALS as readonly string[]).includes(goal)) return { error: "Pick what you're aiming for." };

  const platforms = (Array.isArray(body.platforms) ? body.platforms : [])
    .filter((p): p is SocialPlatform => typeof p === "string" && VALID_PLATFORMS.has(p as SocialPlatform));
  if (platforms.length === 0) return { error: "Pick at least one place to post." };

  return { cadence, control, goal, platforms } as AssistantSetup;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const tenant = (await workspaceKey(req.nextUrl.searchParams.get("wsid"))) ?? "default";
  const saved = await assistantStore().get(tenant);
  const queue = await automationRepo().listQueue(tenant).catch(() => []);

  // What moved, alongside what is planned.
  //
  // The hero already answers "is it running". It has never answered "did it work", which is
  // the question that decides whether anyone renews — and the measurement existed the whole
  // time, computed weekly and delivered only as a push notification.
  //
  // Null is the common case and stays null: no Search Console, one snapshot, or a flat week
  // all mean there is nothing measured to report, and the hero says nothing rather than
  // reporting a zero.
  const result = await latestResult(tenant).catch(() => null);

  const status = buildStatus(queue, {
    configured: !!saved,
    paused: saved?.paused ?? false,
    platforms: saved?.platforms ?? [],
  });

  return NextResponse.json({
    ok: true,
    status,
    result,
    setup: saved ? { cadence: saved.cadence, platforms: saved.platforms, control: saved.control, goal: saved.goal } : null,
    advanced: saved?.advanced ?? ADVANCED_DEFAULTS,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const limit = rateLimit(requestKey(req.headers, session.userId), 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  const store = assistantStore();
  const op = String(body.op ?? "setup");

  // ---- Pause / resume. One switch, and it stops everything from going out.
  if (op === "pause" || op === "resume") {
    const saved = await store.get(tenant);
    if (!saved) return NextResponse.json({ error: "not_configured" }, { status: 409 });

    const paused = op === "pause";
    await store.save({ ...saved, paused, updatedAt: Date.now() });

    // The switch has to reach the automations themselves, or "Paused" would be a label on a
    // screen while posts kept going out — the worst possible version of this feature.
    // materialize() skips inactive rules, so this also stops new slots being planned.
    const repo = automationRepo();
    const autos = await repo.listAutomations(tenant).catch(() => []);
    for (const a of autos) await repo.saveAutomation({ ...a, active: !paused });

    return NextResponse.json({ ok: true, paused });
  }

  // ---- Initial setup, or changing an answer later.
  const parsed = readSetup(body);
  if ("error" in parsed) return NextResponse.json({ error: "invalid_setup", hint: parsed.error }, { status: 422 });

  const now = Date.now();
  const existing = await store.get(tenant);

  await store.save({
    tenant,
    ...parsed,
    paused: false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    advanced: existing?.advanced ?? ADVANCED_DEFAULTS,
  });

  // Each chosen platform becomes one plain-language rule the existing engine already knows
  // how to keep. Early-access platforms are included: Populr writes for them, and the queue
  // holding that content is what makes it available the day publishing opens.
  const repo = automationRepo();
  const plan = planFor(parsed);
  const built: Automation[] = [];
  const failed: { platform: string; reason: string }[] = [];

  for (const p of plan) {
    const result = createAutomations(tenant, p.statement, { release: p.release, now });
    built.push(...result.automations);
    for (const r of result.rejected) failed.push({ platform: p.platform, reason: r.reason });
  }

  if (built.length === 0) {
    return NextResponse.json(
      { error: "setup_failed", hint: "Populr could not turn that into a posting plan. Try a different cadence.", detail: failed },
      { status: 422 },
    );
  }

  // Changing an answer replaces the plan rather than adding to it. Without this, picking a
  // lighter cadence would leave the old heavier rules running alongside the new ones and
  // quietly post more, not less.
  const previous = await repo.listAutomations(tenant).catch(() => []);
  for (const old of previous) await repo.saveAutomation({ ...old, active: false });

  for (const a of built) await repo.saveAutomation(a);

  // Turn the rules into actual dated slots, so the status screen has something true to
  // report the moment setup finishes rather than after the next cron tick.
  const existingQueue = await repo.listQueue(tenant).catch(() => []);
  const queue = materialize(built, existingQueue, { from: now });
  await repo.saveQueue(queue.filter((q) => !existingQueue.some((e) => e.id === q.id)));
  return NextResponse.json({
    ok: true,
    status: buildStatus(queue, { configured: true, paused: false, platforms: parsed.platforms, now }),
    // Reported rather than swallowed: if a platform did not take, the screen can say which.
    skipped: failed,
  });
}
