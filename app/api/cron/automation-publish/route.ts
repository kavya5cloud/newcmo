import { NextRequest, NextResponse } from "next/server";
import { socialEngine } from "@/lib/social/shared";
import { automationRepo } from "@/lib/automation/shared";
import { extend, retryFailed, runDue, type PublishPort } from "@/lib/automation/runner";
import { resolveContent, type ResolvedContent } from "@/lib/automation/sources";
import { recordGeneration } from "@/lib/content/generation-log";
import type { Automation, QueueItem } from "@/lib/automation/types";

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
 * The topic an automation writes about.
 *
 * The statement the founder typed is a cadence, not a subject ("3 LinkedIn posts every
 * week"). The subject is the business itself, so the composer's own context assembly —
 * brand, website, market, memory, learning — supplies it. The statement is passed through
 * as a hint so a rule that *does* name a subject is honoured.
 */
function topicFor(a: Automation | undefined, slot: QueueItem): string {
  const stated = a?.statement?.replace(/\b\d+\b|\bposts?\b|\bevery\b|\bdaily\b|\bweekly\b|\bmonthly\b/gi, "").trim();
  return stated && stated.length > 12 ? stated : `an update for ${slot.platform} about what we shipped recently`;
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

      // Remember how each slot's content was produced, so Learning receives the
      // provenance alongside the outcome rather than just "something published".
      const provenance = new Map<string, ResolvedContent>();

      // Text already queued, so the pipeline can catch a duplicate before it posts twice.
      const scheduledTexts: string[] = [];

      const run = await runDue(queue, tenant, {
        now, engine,
        scheduledTexts,
        onOptimized: (slotId, result) => {
          scheduledTexts.push(result.optimization.optimized.text);
          console.info(JSON.stringify({
            event: "prepublish", tenant, slot: slotId,
            source: result.optimization.source, provider: result.optimization.provider,
            applied: result.optimization.applied,
            errors: result.validation.errors.map((e) => e.code),
            warnings: result.validation.warnings.map((w) => w.code),
          }));
        },
        content: async (slot) => {
          const automation = automations.find((a) => a.id === slot.automationId);
          const resolved = await resolveContent(slot, {
            topic: topicFor(automation, slot),
            audience: "founders",
            now,
          });
          if (resolved) provenance.set(slot.id, resolved);
          return resolved ? { text: resolved.text, assetIds: resolved.assetIds } : null;
        },
      });
      queue = run.queue;

      // Feed the Learning Engine what was published and how it was made. Correlating
      // provider, confidence and source with performance is the whole point of storing it.
      for (const o of run.outcomes) {
        const p = provenance.get(o.slotId);
        if (!p) continue;
        await recordGeneration({
          tenant, kind: "content", format: `automation:${p.origin}`,
          source: p.origin === "ai_queue" ? "llm" : "deterministic",
          provider: p.provider, model: p.model,
          confidence: p.confidence ?? 0.3, platforms: 1,
        }).catch(() => { /* metadata must never fail a publish */ });
      }

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
