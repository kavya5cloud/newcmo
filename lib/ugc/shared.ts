import { db } from "@/lib/db";
import { InMemoryUgcRepo, NeonUgcRepo, type UgcRepo } from "./store";

let repo: UgcRepo | null = null;

/** One process-wide UGC repository — Neon when configured, in-memory otherwise. */
export function ugcRepo(): UgcRepo {
  if (!repo) {
    const sql = db();
    repo = sql ? new NeonUgcRepo(sql) : new InMemoryUgcRepo();
  }
  return repo;
}
