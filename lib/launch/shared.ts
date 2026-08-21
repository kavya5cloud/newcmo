import { db } from "@/lib/db";
import { createLaunch } from "./engine";
import { NeonLaunchRepo } from "./store";
import { InMemoryWorkspaceStateRepo, NeonWorkspaceStateRepo, type WorkspaceStateRepo } from "./workspace-store";
import type { LaunchInput, LaunchPlan } from "./types";

// Shared Launch Workspace wiring. One process-wide state repo (Neon when a database is
// configured, in-memory otherwise) and one agreed default plan, so the server-rendered
// workspace and the APIs that act on it never disagree about what "the current launch" is.

export const DEFAULT_LAUNCH: LaunchInput = {
  launchType: "ai_tool_launch",
  mission: "Launch Populr, the AI CMO",
  business: { name: "Populr", audience: "seed-stage founders", oneLiner: "an AI CMO that reasons" },
  timelineDays: 28,
};

/**
 * A launch input for a real business, or null when we do not know one.
 *
 * Null rather than a filled-in guess: the page falls back to DEFAULT_LAUNCH and labels
 * itself a worked example, which is honest. A plan for a business named "" presented as
 * the visitor's own is not.
 *
 * Extracted from the page so it can be tested. It decides what every visitor sees on the
 * flagship screen, which is too much judgement to leave inside a component.
 */
export function launchInputFor(
  profile: { name?: string; oneLiner?: string; audience?: string; url?: string } | null,
): LaunchInput | null {
  const name = profile?.name?.trim();
  if (!name) return null;
  const clean = (v: string | undefined) => v?.trim() || undefined;
  return {
    ...DEFAULT_LAUNCH,
    mission: `Grow ${name}`,
    business: {
      name,
      oneLiner: clean(profile?.oneLiner),
      audience: clean(profile?.audience),
      url: clean(profile?.url),
    },
    audience: clean(profile?.audience),
  };
}

let stateRepo: WorkspaceStateRepo | null = null;

export function workspaceStateRepo(): WorkspaceStateRepo {
  if (!stateRepo) {
    const sql = db();
    stateRepo = sql ? new NeonWorkspaceStateRepo(sql) : new InMemoryWorkspaceStateRepo();
  }
  return stateRepo;
}

/**
 * The plan the workspace is acting on. A persisted launch wins; otherwise the deterministic
 * default plan is recomputed — identical every time, so actions taken against it are stable
 * even before a database is attached.
 */
export async function resolvePlan(workspaceKey: string, launchId?: string | null): Promise<LaunchPlan> {
  const sql = db();
  if (sql && launchId) {
    try {
      const rec = await new NeonLaunchRepo(sql).get(workspaceKey, launchId);
      if (rec) return rec.plan;
    } catch (e) {
      // A database hiccup must not take the workspace down: the default plan is
      // deterministic, so the dashboard still renders the launch it was showing.
      console.warn(JSON.stringify({ event: "launch_plan_fallback", launchId, error: String(e).slice(0, 200) }));
    }
  }
  return createLaunch(DEFAULT_LAUNCH);
}
