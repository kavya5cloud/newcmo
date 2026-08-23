import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { automationRepo } from "@/lib/automation/shared";
import { loadCanonicalProfile } from "@/lib/services/cmo-context";
import { createLaunch } from "@/lib/launch/engine";
import { launchInputFor } from "@/lib/launch/shared";
import { assembleContext } from "@/lib/agents/context";
import { AGENT_PROFILES, TEAM_ORDER } from "@/lib/agents/registry";
import { teamPlatform } from "@/lib/agents/shared";
import { lastAgentPass, recordAgentPass } from "@/lib/agents/pass-log";

export const runtime = "nodejs";
export const maxDuration = 60;

// The team works without being asked.
//
// Nine agents existed, each doing real work through a real engine, and every one of them
// only ever ran when somebody opened a screen and pressed something. A marketing department
// that works while you sleep does not wait to be started; it was a board you had to operate.
//
// So this runs the team once a day per workspace. Research reads the market and writes what
// it found to memory, SEO audits the site, the Editor grades whatever has been drafted,
// Analytics reads what actually published, Learning feeds the outcomes back. By the time a
// founder opens the Team screen the work has happened, which is the entire difference
// between an agent and a button.
//
// Called by the same ten-minute workflow as the publish pass. Being due is decided here
// rather than by a second schedule: a "once a day" job on a cron is a job that runs at 00:00
// UTC whatever else is true, and one that checks whether it is due can be called as often as
// anything else without doing the work twice.

function authCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (req.headers.get("x-vercel-cron")) return true;
  if (!secret) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

/** Whole days since the epoch, so "already ran today" is a comparison rather than a window. */
const dayOf = (at: number) => Math.floor(at / 86_400_000);

export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const sql = db();
  if (!sql) return NextResponse.json({ ok: true, at: now, tenants: 0, note: "no database" });

  // The same shared-deadline discipline the publish pass uses. A pass is mostly
  // deterministic — only Research calls a model — but "mostly" is not a guarantee across an
  // unknown number of workspaces, and being killed mid-run is how state gets stranded.
  const deadline = now + 45_000;
  const ran: { tenant: string; agents: number; failed: number }[] = [];
  let skipped = 0;

  try {
    const platform = teamPlatform();

    for (const tenant of await automationRepo().activeTenants()) {
      if (Date.now() > deadline) { skipped++; continue; }

      // Once a day, and the check is per workspace rather than global so one slow tenant
      // cannot consume another's turn.
      const last = await lastAgentPass(tenant);
      if (last && dayOf(last) === dayOf(now)) continue;

      // The team works for the business, not for a demo. Same source as the Team screen and
      // the daily brief, so all three cannot disagree about who the customer is.
      const profile = await loadCanonicalProfile(sql, tenant).catch(() => null);
      const input = launchInputFor(profile);
      // No analysed business means nothing to plan for. Skipped rather than run against our
      // own default, which would fill their board with work on our company.
      if (!input) continue;

      const plan = createLaunch(input);
      const campaign = plan.campaigns[0];
      if (!campaign) continue;

      const ctx = await assembleContext({ tenant, launchId: plan.launchId, plan, campaign, now });
      let state = await platform.state.get(tenant, plan.launchId);

      let agents = 0, failed = 0;
      for (const id of TEAM_ORDER) {
        if (Date.now() > deadline) { skipped++; break; }
        // One step per agent — the first it owns. A pass is a daily sweep, not a full
        // execution: publishing has its own loop with its own claim semantics, and running
        // it from here would give one queue two owners.
        const step = AGENT_PROFILES[id].steps[0];
        if (!step || step === "publishing" || step === "platform_optimization") continue;

        const r = await platform.runner.run(state, ctx, step);
        if (r.task) {
          agents++;
          if (r.task.status === "failed") failed++;
        }
      }

      state = await platform.state.save(state);
      await recordAgentPass(tenant, now);
      ran.push({ tenant, agents, failed });

      console.info(JSON.stringify({ event: "agent_pass", tenant, agents, failed }));
    }

    return NextResponse.json({ ok: true, at: now, tenants: ran.length, skipped, ran });
  } catch (e) {
    console.error(JSON.stringify({ event: "agent_pass_failed", error: String(e).slice(0, 300) }));
    return NextResponse.json({ error: "pass_failed" }, { status: 500 });
  }
}
