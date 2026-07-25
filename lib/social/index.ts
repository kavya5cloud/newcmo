// Cross-Platform Publishing System — connect social accounts via OAuth, store tokens
// encrypted, draft / publish now / schedule (timezone-aware) to LinkedIn, Instagram
// Business, Facebook Pages, X, Threads and Pinterest. The scheduler/queue/workers are
// platform-agnostic and execute jobs THROUGH adapters only. Additive; nothing redesigned.

export * from "./types";
export { seal, open, maskToken } from "./crypto";
export { OAuthService, sealToken, openToken, InMemoryCredentialStore, NeonCredentialStore, type CredentialStore } from "./oauth";
export { createReferenceAdapters, CONSTRAINTS } from "./adapters";
export { AdapterRegistry, createAdapterRegistry } from "./registry";
export { zonedTimeToEpoch, parseSchedule, formatInZone, isDue, backoffMs, type WallClock } from "./scheduler";
export { executeJob, type WorkerOutcome } from "./worker";
export {
  InMemoryAccountStore, InMemoryDraftStore, InMemoryJobStore, InMemoryHistoryStore,
  NeonAccountStore, NeonDraftStore, NeonJobStore, NeonHistoryStore,
  type AccountStore, type DraftStore, type JobStore, type HistoryStore,
} from "./store";
export { SocialPublishingEngine, type EngineOptions, type SocialStores } from "./engine";
export { socialEngine } from "./shared";
