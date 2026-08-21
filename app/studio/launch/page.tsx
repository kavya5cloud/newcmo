import { db } from "@/lib/db";
import { workspaceKey } from "@/lib/intel";
import { loadCanonicalProfile } from "@/lib/services/cmo-context";
import { createLaunch } from "@/lib/launch/engine";
import { DEFAULT_LAUNCH, launchInputFor } from "@/lib/launch/shared";
import LaunchWorkspaceClient from "./Workspace";

// Launch Workspace — the deterministic plan is computed on the server by the Launch Engine
// (no mock data); the client shell layers execution state, actions and live panels on top.
// The plan is the same one /api/launch/* acts on, so the page and the APIs never disagree.
//
// The plan used to be DEFAULT_LAUNCH unconditionally, which is "Launch Populr, the AI CMO"
// for "seed-stage founders". So every visitor watched nine agents do genuinely real work —
// research, strategy, SEO, copy, editing, publishing — on *our* company. The machinery was
// never the problem; it was pointed at the wrong business.
//
// business_profiles is the canonical record of what a workspace is, and it is already what
// the daily brief writes from. Same source here, so the team and the scheduler cannot
// disagree about who they work for.

export const dynamic = "force-dynamic";

export default async function LaunchWorkspace() {
  const sql = db();
  const tenant = sql ? await workspaceKey(null) : null;
  const profile = sql && tenant ? await loadCanonicalProfile(sql, tenant).catch(() => null) : null;

  const input = launchInputFor(profile);
  return <LaunchWorkspaceClient plan={createLaunch(input ?? DEFAULT_LAUNCH)} isExample={!input} />;
}
