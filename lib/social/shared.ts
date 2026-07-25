import { db } from "@/lib/db";
import { SocialPublishingEngine } from "./engine";
import { NeonCredentialStore } from "./oauth";
import { NeonAccountStore, NeonDraftStore, NeonJobStore, NeonHistoryStore } from "./store";

// Shared Cross-Platform Publishing engine for the API routes. One process-wide engine;
// persists through the Neon stores when a database is configured, in-memory otherwise.

let engine: SocialPublishingEngine | null = null;

export function socialEngine(): SocialPublishingEngine {
  if (!engine) {
    const sql = db();
    engine = new SocialPublishingEngine({
      stores: sql ? {
        accounts: new NeonAccountStore(sql), drafts: new NeonDraftStore(sql),
        jobs: new NeonJobStore(sql), history: new NeonHistoryStore(sql), credentials: new NeonCredentialStore(sql),
      } : undefined,
    });
  }
  return engine;
}
