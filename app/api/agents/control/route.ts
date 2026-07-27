import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { resolvePlan } from "@/lib/launch/shared";
import { AGENT_PROFILES } from "@/lib/agents/registry";
import { teamPlatform } from "@/lib/agents/shared";
import { clearFailures, decideTask, setPaused, setRequiresApproval } from "@/lib/agents/runner";
import { AGENT_IDS, type AgentId } from "@/lib/agents/types";

export const runtime = "nodejs";

// Operator control over the team: pause, resume, retry, approve, dismiss, and whether an
// agent's output needs sign-off. These change *who may work*; they never run anything —
// the Execution Engine remains the only thing that starts work.

const OPS = ["pause", "resume", "retry", "approve", "dismiss", "require_approval"] as const;
type Op = (typeof OPS)[number];

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const op = String(body.op || "") as Op;
  if (!(OPS as readonly string[]).includes(op)) {
    return NextResponse.json({ error: "invalid_op", hint: OPS.join(" | ") }, { status: 422 });
  }

  const agent = body.agent ? String(body.agent) as AgentId : null;
  const needsAgent = op !== "approve" && op !== "dismiss";
  if (needsAgent && (!agent || !(AGENT_IDS as readonly string[]).includes(agent))) {
    return NextResponse.json({ error: "invalid_agent", hint: AGENT_IDS.join(" | ") }, { status: 422 });
  }

  const taskId = body.taskId ? String(body.taskId) : null;
  if ((op === "approve" || op === "dismiss") && !taskId) {
    return NextResponse.json({ error: "missing_taskId" }, { status: 422 });
  }

  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  try {
    const plan = await resolvePlan(tenant, (body.launchId as string) ?? null);
    const p = teamPlatform();
    let state = await p.state.get(tenant, plan.launchId);
    const now = Date.now();
    let message = "";

    switch (op) {
      case "pause":
        state = setPaused(state, agent!, true, now);
        message = `${AGENT_PROFILES[agent!].name} paused. Steps it owns will hold until you resume it.`;
        break;
      case "resume":
        state = setPaused(state, agent!, false, now);
        message = `${AGENT_PROFILES[agent!].name} resumed. Retry its step to continue the run.`;
        break;
      case "retry":
        // Clearing the failed record is all that's needed: the Execution Engine's retry
        // re-runs the step, and the agent runs clean rather than resuming half-done work.
        state = clearFailures(state, agent!, now);
        message = `${AGENT_PROFILES[agent!].name} cleared for retry. Retry the failed step from Execution.`;
        break;
      case "approve":
        state = decideTask(state, taskId!, "approved", now);
        message = "Work approved.";
        break;
      case "dismiss":
        state = decideTask(state, taskId!, "dismissed", now);
        message = "Recommendation dismissed. It won't be shown again.";
        break;
      case "require_approval":
        state = setRequiresApproval(state, agent!, Boolean(body.required), now);
        message = body.required
          ? `${AGENT_PROFILES[agent!].name} will hold for approval before the run continues.`
          : `${AGENT_PROFILES[agent!].name} no longer needs approval.`;
        break;
    }

    await p.state.save(state);
    return NextResponse.json({
      ok: true, message,
      agents: p.board.summaries(state),
      totals: p.board.totals(state),
      waitingApproval: p.board.waitingApproval(state),
    });
  } catch (e) {
    return NextResponse.json({ error: "control_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
