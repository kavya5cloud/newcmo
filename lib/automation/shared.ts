import { db } from "@/lib/db";
import { InMemoryAutomationRepo, NeonAutomationRepo, type AutomationRepo } from "./store";

let repo: AutomationRepo | null = null;

/** One process-wide automation repository — Neon when configured, in-memory otherwise. */
export function automationRepo(): AutomationRepo {
  if (!repo) {
    const sql = db();
    repo = sql ? new NeonAutomationRepo(sql) : new InMemoryAutomationRepo();
  }
  return repo;
}
