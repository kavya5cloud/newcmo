import type { WorkflowStep } from "@/lib/execution/types";

// Milestone 15 — the AI Marketing Team.
//
// Agents are workers, not chatbots and not orchestrators. The Campaign Execution Engine
// (M14) decides what runs and when; an agent is handed a step, does one job through the
// services that already exist, and reports what it did and why. Agents never call each
// other — everything they share travels through the Execution Engine, the Business Graph,
// Market Memory and the Learning Engine.

export const AGENT_IDS = [
  "research", "strategy", "content", "creative", "publishing", "analytics", "learning",
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type AgentProfile = {
  id: AgentId;
  name: string;
  role: string;
  /** What this agent is accountable for — shown in the AI Team panel. */
  responsibilities: string[];
  /** The existing services it works through. Named so nobody re-implements them. */
  uses: string[];
  /** Workflow steps this agent owns. The Execution Engine maps steps → agents. */
  steps: WorkflowStep[];
};

export const AGENT_STATUSES = ["idle", "running", "waiting_approval", "paused", "completed", "failed"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const AGENT_ACTIONS = ["pause", "resume", "retry", "approve", "dismiss"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

/** One unit of work an agent performed — the transparency record. */
export type AgentTask = {
  id: string;
  tenant: string;
  launchId: string;
  campaignId: string;
  agent: AgentId;
  step: WorkflowStep;
  status: AgentStatus;
  /** What it is doing / did, in one line. */
  task: string;
  /** Why it did that — plain language, always populated. */
  reasoning: string;
  /** 0..1. Derived from the evidence the agent actually had, never a flourish. */
  confidence: number;
  /** Concrete artefacts or findings produced. */
  outputs: string[];
  /** Agent ids whose work this depended on. */
  dependsOn: AgentId[];
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  error: string | null;
  /** Set when a human has approved or dismissed this agent's work. */
  decision: "approved" | "dismissed" | null;
  decidedAt: number | null;
};

/** What an agent produces. The runner turns this into an AgentTask. */
export type AgentOutcome = {
  ok: boolean;
  task: string;
  reasoning: string;
  confidence: number;
  outputs: string[];
  error?: string;
};

/**
 * Everything every agent receives. Assembled once per run from the live services so no
 * agent has to go fetching — and so two agents can never see different truths.
 */
export type SharedContext = {
  tenant: string;
  launchId: string;
  campaignId: string;
  brand: { name: string; oneLiner: string; voice: string[] };
  audience: string;
  campaign: { id: string; title: string; goal: string; phase: string; channels: string[]; assetCount: number };
  goals: { objectives: string[]; kpis: { metric: string; target: string; timeframe: string }[] };
  connectedPlatforms: { platform: string; handle: string; status: string }[];
  analytics: { published: number; failed: number; scheduled: number };
  market: { headline: string; trends: string[]; competitors: string[]; opportunities: string[] };
  /** Prior launches and campaigns already recorded — what Populr has done before. */
  previousCampaigns: string[];
  /** Recall from Market Memory, keyed by subject. */
  memory: { key: string; value: string; performance: number | null }[];
  now: number;
};

/** Per-agent operator control, honoured by the runner before any work starts. */
export type AgentControls = {
  paused: Partial<Record<AgentId, boolean>>;
  /** Agents whose output must be approved before the run continues past them. */
  requiresApproval: Partial<Record<AgentId, boolean>>;
};

export function emptyControls(): AgentControls {
  return { paused: {}, requiresApproval: {} };
}

export type TeamState = {
  tenant: string;
  launchId: string;
  tasks: AgentTask[];
  controls: AgentControls;
  updatedAt: number;
};

export function emptyTeamState(tenant: string, launchId: string, now = Date.now()): TeamState {
  return { tenant, launchId, tasks: [], controls: emptyControls(), updatedAt: now };
}

// ---- Derived dashboard views ----

export type AgentSummary = {
  agent: AgentId;
  name: string;
  role: string;
  status: AgentStatus;
  paused: boolean;
  currentTask: AgentTask | null;
  completed: number;
  failed: number;
  awaitingApproval: number;
  avgConfidence: number | null;
  avgDurationMs: number | null;
  lastActiveAt: number | null;
};

/** A node in the execution graph the panel draws: who worked, and on whose output. */
export type TeamGraphNode = {
  agent: AgentId;
  name: string;
  status: AgentStatus;
  dependsOn: AgentId[];
  taskCount: number;
};
