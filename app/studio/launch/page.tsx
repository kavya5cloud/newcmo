import { createLaunch } from "@/lib/launch/engine";
import { DEFAULT_LAUNCH } from "@/lib/launch/shared";
import LaunchWorkspaceClient from "./Workspace";

// Launch Workspace — the deterministic plan is computed on the server by the Launch Engine
// (no mock data); the client shell layers execution state, actions and live panels on top.
// The plan is the same one /api/launch/* acts on, so the page and the APIs never disagree.

export default function LaunchWorkspace() {
  return <LaunchWorkspaceClient plan={createLaunch(DEFAULT_LAUNCH)} />;
}
