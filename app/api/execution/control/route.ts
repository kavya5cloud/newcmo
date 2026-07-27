import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { loadContext, tenantOf } from "@/lib/execution/api-helpers";
import { executionPlatform } from "@/lib/execution/shared";
import {
  EXECUTION_MODES, STEP_ACTIONS, WORKFLOW_STEPS,
  type ExecutionMode, type StepAction, type WorkflowStep,
} from "@/lib/execution/types";

export const runtime = "nodejs";

// Execution control — run, pause, resume, retry, cancel, emergency stop, mode, recurrence,
// and per-step actions from the timeline. One route because they all mutate the same state
// and must not race each other across several endpoints.

const OPS = [
  "run", "pause", "resume", "retry", "cancel", "step",
  "emergency_stop", "clear_emergency_stop", "mode", "recurrence", "drain",
] as const;
type Op = (typeof OPS)[number];

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 15, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const op = String(body.op || "") as Op;
  if (!(OPS as readonly string[]).includes(op)) {
    return NextResponse.json({ error: "invalid_op", hint: OPS.join(" | ") }, { status: 422 });
  }

  const tenant = await tenantOf((body.wsid as string) ?? null);
  const p = executionPlatform();

  try {
    const ctx = await loadContext(tenant, (body.launchId as string) ?? null);
    let state = ctx.execution;
    const campaignId = body.campaignId ? String(body.campaignId) : null;
    const needsCampaign = ["run", "pause", "resume", "retry", "cancel", "step", "mode", "recurrence"].includes(op);
    if (needsCampaign && !campaignId) return NextResponse.json({ error: "missing_campaignId" }, { status: 422 });

    let message = "";
    switch (op) {
      case "run": {
        const mode = body.mode ? String(body.mode) as ExecutionMode : undefined;
        if (mode && !EXECUTION_MODES.includes(mode)) return NextResponse.json({ error: "invalid_mode" }, { status: 422 });
        const r = await p.engine.run(state, ctx.plan, campaignId!, {
          mode,
          startAfter: body.startAfter == null ? undefined : Number(body.startAfter),
        });
        state = r.state; message = r.message;
        if (!r.ok && r.stopped === "emergency_stopped") {
          await p.state.save(state);
          return NextResponse.json({ error: "emergency_stopped", message }, { status: 409 });
        }
        break;
      }
      case "pause": state = await p.engine.pauseCampaign(state, campaignId!); message = "Campaign paused."; break;
      case "resume": { const r = await p.engine.resumeCampaign(state, ctx.plan, campaignId!); state = r.state; message = r.message; break; }
      case "retry": { const r = await p.engine.retryFailed(state, ctx.plan, campaignId!); state = r.state; message = r.message; break; }
      case "cancel": state = await p.engine.cancelCampaign(state, campaignId!); message = "Campaign cancelled."; break;
      case "step": {
        const step = String(body.step || "") as WorkflowStep;
        const action = String(body.action || "") as StepAction;
        if (!(WORKFLOW_STEPS as readonly string[]).includes(step)) return NextResponse.json({ error: "invalid_step" }, { status: 422 });
        if (!(STEP_ACTIONS as readonly string[]).includes(action)) return NextResponse.json({ error: "invalid_action" }, { status: 422 });
        const r = await p.engine.act(state, ctx.plan, campaignId!, step, action);
        state = r.state; message = r.message;
        if (!r.ok) { await p.state.save(state); return NextResponse.json({ error: "illegal_transition", message }, { status: 409 }); }
        break;
      }
      case "emergency_stop": state = await p.engine.emergencyStop(state); message = "Emergency stop engaged. Nothing will run until it is cleared."; break;
      case "clear_emergency_stop": state = await p.engine.clearEmergencyStop(state); message = "Emergency stop cleared."; break;
      case "mode": {
        const mode = String(body.mode || "") as ExecutionMode;
        if (!EXECUTION_MODES.includes(mode)) return NextResponse.json({ error: "invalid_mode" }, { status: 422 });
        state = p.engine.setMode(state, campaignId!, mode); message = `Mode set to ${mode}.`;
        break;
      }
      case "recurrence": {
        const days = body.everyDays == null ? null : Number(body.everyDays);
        if (days !== null && (!Number.isFinite(days) || days < 1 || days > 365)) {
          return NextResponse.json({ error: "invalid_recurrence", hint: "1–365 days, or null to stop recurring" }, { status: 422 });
        }
        state = p.engine.setRecurrence(state, campaignId!, days);
        message = days ? `Recurring every ${days} day${days === 1 ? "" : "s"}.` : "Recurrence removed.";
        break;
      }
      case "drain": state = await p.engine.drainQueue(state, ctx.plan); message = "Queue drained."; break;
    }

    await p.state.save(state);
    return NextResponse.json({
      ok: true, message,
      emergencyStopped: state.emergencyStopped,
      queue: state.queue,
      campaigns: Object.values(state.campaigns).map((c) => p.engine.view(c)),
    });
  } catch (e) {
    return NextResponse.json({ error: "control_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
