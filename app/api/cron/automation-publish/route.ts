import { NextRequest, NextResponse } from "next/server";
import { socialEngine } from "@/lib/social/shared";
import { automationRepo } from "@/lib/automation/shared";
import { extend, retryFailed, runDue, type PublishPort } from "@/lib/automation/runner";
import type { QueueItem } from "@/lib/automation/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// The minute hand of automated publishing.
//
// Find due slots → claim → publish through the M12 engine → record → retry what can be
// retried → extend the horizon so recurring schedules never run dry.
//
// Everything that makes this safe lives one layer down: the claim is a guarded state
// transition, and the publish carries the slot id as an idempotency key that the
// Publishing Engine de-duplicates on. This route is a loop, not a scheduler.

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Vercel signs its own cron invocations; a shared secret covers manual runs.
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

/**
 * Where a slot's text comes from.
 *
 * Today: the automation's own statement is not the post — a slot sourced from drafts
 * takes the oldest unscheduled draft. Sources that have no content yet return null, and
 * the runner marks the slot failed with a reason rather than posting a placeholder.
 */
async function contentFor(slot: QueueItem): Promise<{ text: string; assetIds: string[] } | null> {
  const engine = socialEngine();
  if (slot.source === "drafts") {
    const drafts = await engine.listDrafts(slot.tenant).catch(() => []);
    const match = drafts.find((d) => d.platforms.includes(slot.platform)) ?? drafts[0];
    return match ? { text: match.content.text, assetIds: match.content.assetIds } : null;
  }
  // Other sources are not wired yet. Returning null is deliberate: the slot fails with
  // "no content available", which is true, instead of publishing filler.
  return null;
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const repo = automationRepo();
  const engine = socialEngine() as unknown as PublishPort;

  const report: { tenant: string; published: number; failed: number; retried: number; extended: number }[] = [];

  try {
    for (const tenant of await repo.activeTenants()) {
      const automations = await repo.listAutomations(tenant);
      let queue = await repo.listQueue(tenant);

      // Retries first: a slot whose backoff has elapsed rejoins this same run.
      const retry = retryFailed(queue, { now });
      queue = retry.queue;

      const run = await runDue(queue, tenant, { now, engine, content: contentFor });
      queue = run.queue;

      const before = queue.length;
      queue = extend(automations, queue, now);

      await repo.saveQueue(queue);

      report.push({
        tenant,
        published: run.outcomes.filter((o) => o.ok).length,
        failed: run.outcomes.filter((o) => !o.ok).length,
        retried: retry.retried.length,
        extended: queue.length - before,
      });

      for (const o of run.outcomes) {
        console.info(JSON.stringify({ event: "automation_publish", tenant, slot: o.slotId, ok: o.ok, state: o.state, message: o.message }));
      }
    }

    return NextResponse.json({ ok: true, at: now, tenants: report.length, report });
  } catch (e) {
    return NextResponse.json({ error: "cron_failed", detail: String(e).slice(0, 200) }, { status: 503 });
  }
}
