// Publishing & Growth Execution Layer. Platforms are adapters; the Asset Graph and
// Business Graph remain the source of truth. Publishing never bypasses the Asset Graph
// lifecycle or approval, and everything is event-driven.

export * from "./types";
export { createReferenceProviders, platformFor } from "./providers";
export { PublishingProviderRegistry, createDefaultRegistry, getPublishingRegistry } from "./registry";
export { EventBus, type EventHandler } from "./events";
export { PublishingEngine, type EngineOptions } from "./engine";
export { PublishingRouter, type RouterOptions, type RouteResult } from "./router";
export { buildCalendar, calendarView, reschedule, duplicate, cancel } from "./calendar";
export {
  ApprovalWorkflow, ensureApprovalsTable, saveApproval, listApprovals,
} from "./approvals";
export { packageFromLaunchPlan, packageUpstream, packageDownstream } from "./packages";
export {
  InMemoryHistoryStore, NeonHistoryStore, type PublishingHistoryStore,
} from "./history";

// Reuse the Milestone 7 lifecycle + experiment + dependency engines (no duplication).
export { PUBLISH_STAGES, PublishingQueue, nextStage, prevStage } from "@/lib/launch/publishing";
export { EXPERIMENT_TYPES, createExperiment, recordResult, decideWinner, runExperiment } from "@/lib/launch/experiments";
export { buildDependencyGraph, flagDependents, upstreamOf } from "@/lib/launch/dependencies";
