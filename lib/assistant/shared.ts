import { db } from "@/lib/db";
import { InMemoryAssistantStore, NeonAssistantStore, type AssistantStore } from "./store";

let store: AssistantStore | null = null;

/** One process-wide assistant store — Neon when configured, in-memory otherwise. */
export function assistantStore(): AssistantStore {
  if (!store) {
    const sql = db();
    store = sql ? new NeonAssistantStore(sql) : new InMemoryAssistantStore();
  }
  return store;
}
