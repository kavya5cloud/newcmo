// Job Orchestration Engine — types. Every AI request in Populr becomes a Job that flows
// through a state machine: Planner → Creative Intelligence → Generation → Creative
// Director → Approval → Publishing (optional) → Learning → Completed. Event-sourced.
//
// Pure types only. No feature calls providers directly anymore — it enqueues a Job.

export const JOB_TYPES = [
  "strategy", "decision", "mission_planning", "campaign_planning", "creative_brief",
  "image_generation", "video_generation", "motion_graphics", "ugc", "document",
  "ads", "publishing", "learning", "market_research",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

// Pipeline states (the happy path) + control/terminal states.
export const JOB_STATES = [
  "queued", "waiting_for_resources", "planning", "creative_intelligence", "generating",
  "creative_director_review", "approval", "publishing", "learning_update", "completed",
  // control / terminal
  "retrying", "paused", "cancelled", "failed", "timed_out",
] as const;
export type JobState = (typeof JOB_STATES)[number];

/** The ordered progress stages (a subset of JOB_STATES, no control states). */
export const PIPELINE_STAGES: JobState[] = [
  "queued", "waiting_for_resources", "planning", "creative_intelligence", "generating",
  "creative_director_review", "approval", "publishing", "learning_update", "completed",
];

export const TERMINAL_STATES: JobState[] = ["completed", "cancelled", "failed", "timed_out"];
export const CONTROL_STATES: JobState[] = ["retrying", "paused", "cancelled", "failed", "timed_out"];

export type JobPriority = "high" | "normal" | "low";
export const PRIORITY_RANK: Record<JobPriority, number> = { high: 0, normal: 1, low: 2 };

export type JobInput = {
  requestType?: string;         // maps to the AI Processing request type for the UI
  workspaceKey?: string;
  brief?: Record<string, unknown>;
  assetKind?: string;
  campaignId?: string | null;
  missionId?: string | null;
  publish?: boolean;            // whether the publishing stage runs
  payload?: Record<string, unknown>;
};

export type JobRefs = {
  assetIds: string[];
  campaignIds: string[];
  missionIds: string[];
  creativeBriefIds: string[];
  specIds: string[];
};

export type JobResult = {
  outputs: Record<string, unknown>;
  provider: string | null;
  modelVersion: string | null;
  cost: number;
  approval: string | null;
  publishing: Record<string, unknown> | null;
  learning: Record<string, unknown> | null;
};

export type Job = {
  id: string;
  type: JobType;
  state: JobState;
  priority: JobPriority;
  progress: number;             // 0..100
  input: JobInput;
  refs: JobRefs;
  result: JobResult | null;
  error: string | null;
  attempts: number;
  maxRetries: number;
  idempotencyKey: string | null;
  cost: number;
  createdAt: number;
  startedAt: number | null;
  updatedAt: number;
  completedAt: number | null;
  estimatedCompletion: number | null;
  /** Stages that apply to this job (its flow through the pipeline). */
  stages: JobState[];
  /** Index in `stages` of the last completed stage (-1 = none). Drives resume/retry. */
  cursor: number;
};

export type JobEventType =
  | "created" | "queued" | "started" | "stage" | "progress" | "retrying"
  | "paused" | "resumed" | "cancelled" | "failed" | "timed_out" | "completed" | "dead_letter";

export type JobEvent = {
  id: string;
  jobId: string;
  type: JobEventType;
  state: JobState;
  progress: number;
  at: number;
  data?: Record<string, unknown>;
};

export type JobLog = {
  jobId: string;
  at: number;
  level: "info" | "warn" | "error";
  message: string;
};

export type JobProgress = {
  jobId: string;
  type: JobType;
  state: JobState;
  percent: number;
  startedAt: number | null;
  updatedAt: number;
  estimatedCompletion: number | null;
  provider: string | null;
  cost: number;
  durationMs: number | null;
  refs: JobRefs;
  stages: JobState[];
  logs: JobLog[];
  // live queue signals (present while queued/waiting) for the AI Processing experience
  estimatedWaitMs?: number;
  queuePosition?: number;
  highDemand?: boolean;
};

// ---- Workers + queue metrics (dashboard) ----

export type WorkerStatus = {
  id: string;
  busy: boolean;
  currentJobId: string | null;
  processed: number;
  failed: number;
};

export type QueueMetrics = {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  retrying: number;
  deadLetter: number;
  avgDurationMs: number;
  avgCost: number;
  concurrency: number;
  workers: WorkerStatus[];
  providerUsage: Record<string, number>;
  systemLoad: number;           // 0..1 running/concurrency
};
