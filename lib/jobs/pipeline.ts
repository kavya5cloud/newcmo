import type { JobState, JobType } from "./types";

// Job pipeline — the ordered stages each job type flows through. Generation-less jobs
// (strategy, decision, learning) skip the generation/review stages; publishing is opt-in.
// A job's `stages` array is its concrete path; the engine advances along it.

const FULL: JobState[] = [
  "queued", "waiting_for_resources", "planning", "creative_intelligence", "generating",
  "creative_director_review", "approval", "learning_update", "completed",
];

const PLANNING_ONLY: JobState[] = ["queued", "waiting_for_resources", "planning", "learning_update", "completed"];

const CREATIVE_FLOW: JobState[] = FULL; // creative brief / spec-building jobs

// Per-type base flow (publishing is inserted when input.publish is set).
const FLOWS: Record<JobType, JobState[]> = {
  strategy: PLANNING_ONLY,
  decision: PLANNING_ONLY,
  mission_planning: PLANNING_ONLY,
  campaign_planning: PLANNING_ONLY,
  creative_brief: CREATIVE_FLOW,
  image_generation: FULL,
  video_generation: FULL,
  motion_graphics: FULL,
  ugc: FULL,
  document: FULL,
  ads: FULL,
  publishing: ["queued", "waiting_for_resources", "approval", "publishing", "learning_update", "completed"],
  learning: ["queued", "waiting_for_resources", "learning_update", "completed"],
  // Market research collects + analyses, then feeds the learning update. No generation.
  market_research: ["queued", "waiting_for_resources", "planning", "learning_update", "completed"],
};

/** The concrete stage path for a job, inserting the optional publishing stage. */
export function stagesFor(type: JobType, opts: { publish?: boolean } = {}): JobState[] {
  const base = [...FLOWS[type]];
  if (opts.publish && !base.includes("publishing")) {
    // Publishing runs after approval, before the learning update.
    const i = base.indexOf("learning_update");
    base.splice(i < 0 ? base.length - 1 : i, 0, "publishing");
  }
  return base;
}

/** The next stage in a job's path, or null at the end. */
export function nextStage(stages: JobState[], current: JobState): JobState | null {
  const i = stages.indexOf(current);
  return i >= 0 && i < stages.length - 1 ? stages[i + 1] : null;
}

/** Progress percent for a state within a job's path (0..100). */
export function percentFor(stages: JobState[], state: JobState): number {
  if (state === "completed") return 100;
  const i = stages.indexOf(state);
  if (i < 0) return 0;
  return Math.round((i / (stages.length - 1)) * 100);
}

// Human labels for the UI (used by the AI Processing experience in live mode).
export const STATE_LABEL: Record<JobState, string> = {
  queued: "Queued",
  waiting_for_resources: "Waiting for resources",
  planning: "Planning",
  creative_intelligence: "Creative Intelligence",
  generating: "Generating",
  creative_director_review: "Creative Director review",
  approval: "Approval",
  publishing: "Publishing",
  learning_update: "Learning update",
  completed: "Completed",
  retrying: "Retrying",
  paused: "Paused",
  cancelled: "Cancelled",
  failed: "Failed",
  timed_out: "Timed out",
};
