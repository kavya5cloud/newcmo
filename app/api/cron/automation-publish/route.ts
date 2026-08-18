import { NextRequest, NextResponse } from "next/server";
import { socialEngine } from "@/lib/social/shared";
import { automationRepo } from "@/lib/automation/shared";
import { extend, retryFailed, runDue, type PublishPort } from "@/lib/automation/runner";
import { resolveContent, type ResolvedContent } from "@/lib/automation/sources";
import { angleKeyFor, topicForSlot } from "@/lib/automation/topic";
import { assistantStore } from "@/lib/assistant/shared";
import { recordGeneration } from "@/lib/content/generation-log";
import type { Automation, QueueItem } from "@/lib/automation/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// The minute hand of automated publishing.
//
// NOT registered in vercel.json. Vercel's Hobby plan allows two cron jobs at daily
// granularity, and a once-a-day publishing cron is not a schedule — so this is driven by
// an external scheduler instead (any service that can make an authenticated GET every
// minute). On a Pro plan, add it back to vercel.json with "* * * * *" and drop the
// external trigger. Either way the endpoint is identical:
//
//   GET /api/cron/automation-publish
//   Authorization: Bearer $CRON_SECRET
//
// It is idempotent, so an overlapping or repeated call cannot double-publish.
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
// What to write about now lives in lib/automation/topic.ts. The old version here derived it
// from the automation's own statement by deleting numbers and cadence words, which produced
// prompts like "LinkedIn   week" and asked for the identical thing every single day.

export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const repo = automationRepo();
  const engine = socialEngine() as unknown as PublishPort;

  const report: { tenant: string; published: number; failed: number; retried: number; extended: number }[] = [];

  try {
    // No feature gate here.
    //
    // Scheduled publishing is included in the one plan, and the free month is a trial of that
    // plan, so there is nothing this could usefully check. A tier lookup that always returns
    // the same answer is worse than none: it costs a query per tenant per run and reads like a
    // rule someone has to keep in mind.
    //
    // Whether a tenant is entitled to anything at all is still decided — by accessFor, which
    // owns the trial, the grace period after a failed payment, and the period a cancelled
    // customer already paid for. That is the only question with a real answer.
    for (const tenant of await repo.activeTenants()) {
      const automations = await repo.listAutomations(tenant);
      let queue = await repo.listQueue(tenant);

      // The goal shapes which angles get used. Absent, every angle is in play, which is
      // still far better than one prompt repeated forever.
      const settings = await assistantStore().get(tenant).catch(() => null);

      // Recently written openings, so today is told what not to repeat. fromAiQueue saves
      // every generated post as a draft, so the drafts are the record of what has been said.
      // Cheap, and more reliable than asking a model to "be original".
      const recentTexts = (await socialEngine().listDrafts(tenant).catch(() => []))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 5)
        .map((d) => d.content.text)
        .filter(Boolean);

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
          const resolved = await resolveContent(slot, {
            // The composer already assembles brand voice, market brief and what has
            // performed (lib/content/generation-context.ts). What it never received was
            // anything that changed between one day and the next — that is this.
            topic: topicForSlot(slot, {
              goal: settings?.goal,
              recent: [...recentTexts, ...scheduledTexts],
            }),
            audience: "founders",
            now,
          });
          if (resolved) provenance.set(slot.id, resolved);

          // The angle is the reason this post says what it says. Logging it makes a run
          // reviewable — "seven posts, seven angles" is checkable; "seven posts" is not.
          console.info(JSON.stringify({
            event: "slot_topic", tenant, slot: slot.id, platform: slot.platform,
            day: new Date(slot.at).toISOString().slice(0, 10),
            angle: angleKeyFor(slot, settings?.goal),
            resolved: !!resolved,
          }));

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

    // Flush the Publishing Engine's own scheduled queue in the same run, after the
    // automation slots have been claimed. Two separate every-minute crons touching the
    // same engine raced each other and doubled the cron count for no benefit; ordering
    // them in one pass means a slot created this minute also dispatches this minute.
    let dispatched = 0;
    try {
      dispatched = (await socialEngine().dispatchDue(now)).length;
    } catch (e) {
      console.warn(JSON.stringify({ event: "dispatch_due_failed", error: String(e).slice(0, 200) }));
    }

    return NextResponse.json({ ok: true, at: now, tenants: report.length, dispatched, report });
  } catch (e) {
    return NextResponse.json({ error: "cron_failed", detail: String(e).slice(0, 200) }, { status: 503 });
  }
}
