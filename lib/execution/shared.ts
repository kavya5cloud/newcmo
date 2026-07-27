import { db } from "@/lib/db";
import { AdaptiveTimeline } from "./adaptive";
import { CampaignExecutionEngine } from "./engine";
import { CampaignHealthService } from "./health";
import { InMemoryExecutionHistory, NeonExecutionHistory, type ExecutionHistoryStore } from "./history";
import { NotificationService } from "./notifications";
import { agentServices } from "./agent-services";
import {
  InMemoryAdaptationRepo, InMemoryExecutionStateRepo, InMemoryNotificationRepo,
  NeonAdaptationRepo, NeonExecutionStateRepo, NeonNotificationRepo,
  type AdaptationRepo, type ExecutionStateRepo, type NotificationRepo,
} from "./store";

// One process-wide execution platform for the API routes, wired to the live engines.
// Durable through Neon when a database is configured, in-memory otherwise.

export type ExecutionPlatform = {
  engine: CampaignExecutionEngine;
  health: CampaignHealthService;
  notifications: NotificationService;
  adaptive: AdaptiveTimeline;
  state: ExecutionStateRepo;
  historyStore: ExecutionHistoryStore;
  dismissals: NotificationRepo;
  adaptations: AdaptationRepo;
};

let platform: ExecutionPlatform | null = null;

export function executionPlatform(): ExecutionPlatform {
  if (!platform) {
    const sql = db();
    const historyStore = sql ? new NeonExecutionHistory(sql) : new InMemoryExecutionHistory();
    platform = {
      // Milestone 15: the workflow is performed by the AI team. The engine is still the
      // only orchestrator — agents are the workers behind its steps.
      engine: new CampaignExecutionEngine({ services: agentServices(), history: historyStore, now: Date.now }),
      health: new CampaignHealthService(),
      notifications: new NotificationService(),
      adaptive: new AdaptiveTimeline(),
      state: sql ? new NeonExecutionStateRepo(sql) : new InMemoryExecutionStateRepo(),
      historyStore,
      dismissals: sql ? new NeonNotificationRepo(sql) : new InMemoryNotificationRepo(),
      adaptations: sql ? new NeonAdaptationRepo(sql) : new InMemoryAdaptationRepo(),
    };
  }
  return platform;
}
