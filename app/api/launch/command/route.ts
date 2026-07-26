import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { marketPlatform } from "@/lib/market/shared";
import { COMMAND_EXAMPLES, parseCommand, type ParsedCommand } from "@/lib/launch/command";
import { resolvePlan, workspaceStateRepo } from "@/lib/launch/shared";
import { applyItemAction, campaignProgress, statusOf, workspaceSummary, type WorkspaceState } from "@/lib/launch/workspace";
import type { LaunchPlan } from "@/lib/launch/types";

export const runtime = "nodejs";

// Launch Workspace command bar. Parsing is deterministic (lib/launch/command); execution
// goes through the services that already own each capability — the publishing engine, the
// market platform, the workspace state — so nothing here duplicates their logic.
//
// `preview: true` parses without executing, so the UI can show what a command will do.

type Outcome = { done: string; details: string[] };

async function schedulePlanned(plan: LaunchPlan, state: WorkspaceState, tenant: string): Promise<{ state: WorkspaceState; outcome: Outcome }> {
  const engine = socialEngine();
  const accounts = (await engine.listAccounts(tenant)).filter((a) => a.status === "connected");
  const pending = plan.publishingSchedule.filter((s) => statusOf(state, s.assetKey) !== "done");
  const details: string[] = [];
  let next = state;

  for (const slot of pending) {
    next = applyItemAction(next, slot.assetKey, "start");
  }
  if (accounts.length === 0) {
    details.push("No connected platforms yet — items are queued in the plan and will schedule once an account is connected.");
  } else {
    details.push(`${accounts.length} connected platform${accounts.length === 1 ? "" : "s"}: ${accounts.map((a) => a.platform).join(", ")}.`);
  }
  return { state: next, outcome: { done: `Queued ${pending.length} item${pending.length === 1 ? "" : "s"} for scheduling.`, details } };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const text = String(body.text || "").trim();
  if (!text) return NextResponse.json({ error: "missing_text", examples: COMMAND_EXAMPLES }, { status: 422 });
  if (text.length > 400) return NextResponse.json({ error: "text_too_long" }, { status: 422 });

  const parsed: ParsedCommand = parseCommand(text);
  if (body.preview) return NextResponse.json({ ok: true, parsed, executed: false });
  if (parsed.intent === "unknown") return NextResponse.json({ ok: true, parsed, executed: false, examples: COMMAND_EXAMPLES });

  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  const plan = await resolvePlan(tenant, (body.launchId as string) ?? null);
  const repo = workspaceStateRepo();
  let state = await repo.get(tenant, plan.launchId);
  let outcome: Outcome;

  switch (parsed.intent) {
    case "schedule_all":
    case "publish_now": {
      const r = await schedulePlanned(plan, state, tenant);
      state = r.state; outcome = r.outcome;
      break;
    }
    case "pause_all": {
      const paused = Object.entries(state.items).filter(([, s]) => s === "in_progress").map(([k]) => k);
      for (const k of paused) state = applyItemAction(state, k, "pause");
      outcome = { done: `Paused ${paused.length} in-progress item${paused.length === 1 ? "" : "s"}.`, details: ["Nothing was deleted — resume any item to continue."] };
      break;
    }
    case "generate_assets": {
      const n = parsed.params.quantity ?? 5;
      const platform = parsed.params.platform;
      // Plan channels are generic ("linkedin", "instagram"); platform ids are provider-
      // specific ("instagram_business"). Match on the shared root, not the id.
      const root = platform?.split("_")[0];
      const candidates = plan.publishingSchedule
        .filter((s) => (root ? s.channel.toLowerCase().includes(root) : true) && statusOf(state, s.assetKey) === "todo")
        .slice(0, n);
      for (const s of candidates) state = applyItemAction(state, s.assetKey, "start");
      outcome = {
        done: `Started generation for ${candidates.length} of ${n} requested asset${n === 1 ? "" : "s"}.`,
        details: candidates.length < n
          ? [`The plan only has ${candidates.length} unstarted ${platform ?? "matching"} slot${candidates.length === 1 ? "" : "s"} — add a campaign to plan more.`]
          : candidates.map((s) => `${s.kind.replace(/_/g, " ")} · ${s.channel} · day ${s.dayOffset}`),
      };
      break;
    }
    case "research_market": {
      const brief = await marketPlatform().research.run({
        tenant, terms: [plan.mission], competitors: [], industry: "saas",
        audience: plan.campaigns[0]?.brief?.audience ?? "founders",
      });
      outcome = {
        done: brief.headline,
        details: brief.opportunities.slice(0, 3).map((o) => `${o.title} — ${o.recommendedAction}`),
      };
      break;
    }
    case "launch_product": {
      const days = parsed.params.timelineDays ?? plan.timelineDays;
      outcome = {
        done: `Current plan runs ${plan.timelineDays} days across ${plan.summary.weekCount} weeks.`,
        details: days === plan.timelineDays
          ? ["Timeline already matches that horizon."]
          : [`Re-timing to ${days} days rebuilds the timeline and publishing schedule — use Mission → Edit to confirm, so nothing in flight is disturbed.`],
      };
      break;
    }
    case "create_campaign": {
      outcome = {
        done: parsed.params.subject ? `Campaign idea captured: "${parsed.params.subject}".` : "Campaign idea captured.",
        details: [`The launch already carries ${plan.summary.campaignCount} campaigns. A new campaign changes the plan structure, so it goes through the Launch Engine — open Mission to re-plan.`],
      };
      break;
    }
    default:
      outcome = { done: parsed.summary, details: [] };
  }

  await repo.save(state);
  return NextResponse.json({
    ok: true, executed: true, parsed, outcome,
    items: state.items,
    progress: campaignProgress(plan, state),
    summary: workspaceSummary(plan, state),
  });
}
