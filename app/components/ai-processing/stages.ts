// AI Processing — the single source of truth for what Populr says it's doing while it
// works. Every stage describes real marketing work, never a model or "loading". Used by
// the useAIProcessing hook + the AIProcessing components across the whole app.

import type { IconName } from "@/app/components/Icon";

export type RequestType = "general" | "strategy" | "launch" | "creative" | "video" | "document";

// `icon` names a drawing in the shared set, not an emoji. Emoji rendered as a different
// picture on every platform, ignored the accent colour, and struck the wrong tone — a job
// finishing is a result, not a party popper.
export type Stage = { icon: IconName; title: string; hint: string };

/** Per-request-type stage sequences (from the product spec). */
export const STAGE_SEQUENCES: Record<RequestType, Stage[]> = {
  general: [
    { icon: "brain", title: "Understanding your business", hint: "Reading your profile and goals" },
    { icon: "chart", title: "Reviewing your marketing context", hint: "Channels, history and what's worked" },
    { icon: "target", title: "Finding the best approach", hint: "Weighing the highest-leverage options" },
    { icon: "sparkle", title: "Preparing your response", hint: "Writing it up clearly" },
  ],
  strategy: [
    { icon: "brain", title: "Understanding your goals", hint: "What growth looks like for you" },
    { icon: "trend", title: "Reviewing previous campaigns", hint: "What moved the numbers before" },
    { icon: "target", title: "Identifying growth opportunities", hint: "Where the upside is" },
    { icon: "chart", title: "Validating recommendations", hint: "Checking the evidence" },
    { icon: "sparkle", title: "Finalizing your strategy", hint: "Turning it into a plan" },
  ],
  launch: [
    { icon: "rocket", title: "Planning your launch", hint: "Objectives and sequencing" },
    { icon: "calendar", title: "Building campaign timeline", hint: "Weeks, phases and dependencies" },
    { icon: "palette", title: "Organizing creative assets", hint: "Every asset the launch needs" },
    { icon: "megaphone", title: "Preparing distribution", hint: "Channels and publishing plan" },
    { icon: "sparkle", title: "Finalizing your launch", hint: "Bringing it all together" },
  ],
  creative: [
    { icon: "palette", title: "Understanding your creative brief", hint: "Audience, message and angle" },
    { icon: "library", title: "Gathering brand context", hint: "Voice, visuals and what wins" },
    { icon: "brain", title: "Building creative direction", hint: "The idea and structure" },
    { icon: "sparkle", title: "Preparing creative assets", hint: "Shaping the output" },
  ],
  video: [
    { icon: "clapper", title: "Planning the story", hint: "Beats, arc and message" },
    { icon: "cast", title: "Building storyboard", hint: "Scenes and shots" },
    { icon: "camera", title: "Preparing scenes", hint: "Framing each moment" },
    { icon: "palette", title: "Rendering visuals", hint: "Bringing the frames to life" },
    { icon: "search", title: "Creative Director reviewing", hint: "Checking it's on-brand" },
    { icon: "sparkle", title: "Finalizing your video", hint: "Last polish" },
  ],
  document: [
    { icon: "doc", title: "Understanding the document", hint: "Purpose and audience" },
    { icon: "library", title: "Gathering business context", hint: "Facts, proof and positioning" },
    { icon: "pen", title: "Writing structured content", hint: "Section by section" },
    { icon: "search", title: "Reviewing quality", hint: "Clarity and accuracy" },
    { icon: "sparkle", title: "Finalizing your document", hint: "Formatting and polish" },
  ],
};

// High-level progress states (each with icon/title/description/animation class).
export type ProgressPhase =
  | "queued" | "preparing" | "planning" | "generating" | "reviewing" | "finalizing" | "completed";

export const PROGRESS_STATES: Record<ProgressPhase, { icon: IconName; title: string; description: string; anim: string }> = {
  queued:     { icon: "queue", title: "Queued", description: "Safely in line", anim: "aip-anim-pulse" },
  preparing:  { icon: "brain", title: "Preparing", description: "Getting your context together", anim: "aip-anim-pulse" },
  planning:   { icon: "target", title: "Planning", description: "Choosing the best approach", anim: "aip-anim-pulse" },
  generating: { icon: "sparkle", title: "Generating", description: "Doing the work", anim: "aip-anim-shimmer" },
  reviewing:  { icon: "search", title: "Reviewing", description: "Checking quality", anim: "aip-anim-pulse" },
  finalizing: { icon: "package", title: "Finalizing", description: "Putting it together", anim: "aip-anim-pulse" },
  completed:  { icon: "check-circle", title: "Completed", description: "Ready", anim: "" },
};

// Live mode — Job pipeline states → display stages (Part 12). Control states are excluded.
export const JOB_STATE_STAGE: Record<string, Stage> = {
  queued: { icon: "queue", title: "Queued", hint: "Safely in line" },
  waiting_for_resources: { icon: "clock", title: "Waiting for resources", hint: "Allocating capacity" },
  planning: { icon: "target", title: "Planning", hint: "Choosing the approach" },
  creative_intelligence: { icon: "brain", title: "Creative Intelligence", hint: "Building the specification" },
  generating: { icon: "sparkle", title: "Generating", hint: "Producing the asset" },
  creative_director_review: { icon: "search", title: "Creative Director review", hint: "Checking it's on-brand" },
  approval: { icon: "check-circle", title: "Approval", hint: "Signing off" },
  publishing: { icon: "megaphone", title: "Publishing", hint: "Distributing" },
  learning_update: { icon: "trend", title: "Learning", hint: "Getting smarter from the outcome" },
  completed: { icon: "check-circle", title: "Completed", hint: "Ready" },
};

/** Build the display stage list for a live job from its concrete pipeline states. */
export function jobDisplayStages(states: string[]): Stage[] {
  return states.map((s) => JOB_STATE_STAGE[s]).filter(Boolean);
}

// Map any product feature to the right stage sequence, so callers can pass a feature name.
const FEATURE_ALIASES: Record<string, RequestType> = {
  chat: "general", general: "general", ask: "general",
  strategy: "strategy", decision: "strategy", planner: "strategy", "decision-planner": "strategy",
  launch: "launch", publishing: "launch", publish: "launch",
  creative: "creative", studio: "creative", image: "creative", images: "creative",
  motion: "creative", "motion-graphics": "creative", ugc: "creative", "creative-director": "creative", ads: "creative",
  video: "video", videos: "video",
  document: "document", documents: "document", doc: "document",
};

export function resolveRequestType(feature: string | RequestType): RequestType {
  return FEATURE_ALIASES[feature] ?? (STAGE_SEQUENCES[feature as RequestType] ? (feature as RequestType) : "general");
}

/** Format an estimated wait for the high-demand experience. */
export function formatWait(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} seconds`;
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}
