import { db, RUNTIME_DDL, type Sql } from "@/lib/db";

// When each workspace last had its team run.
//
// The daily pass is called by the same ten-minute workflow as everything else, so "have we
// already done this today" has to be answerable from storage rather than from the schedule.
// A once-a-day job driven by its own cron entry runs at whatever hour that entry fires and
// silently does nothing about a run that was missed; one that records what it did can be
// called as often as anything else and still work exactly once.
//
// Per workspace, not global. One tenant failing or being slow must not consume another's
// turn for the day.

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS agent_pass_log (
    workspace_key TEXT PRIMARY KEY,
    last_run_at BIGINT NOT NULL
  )`;
  ready = true;
}

/** When the team last ran for this workspace, or null if it never has. */
export async function lastAgentPass(workspaceKey: string): Promise<number | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT last_run_at FROM agent_pass_log WHERE workspace_key = ${workspaceKey}`) as
      { last_run_at: string | number }[];
    return rows[0] ? Number(rows[0].last_run_at) : null;
  } catch {
    // Unknown reads as "never ran". The cost of guessing wrong is one extra pass, which is
    // mostly deterministic work; the cost of the opposite guess is a team that silently
    // stops working the first time a read fails.
    return null;
  }
}

/**
 * Record that the team ran. Written after the work, never before — a timestamp stored on
 * entry would mark the day done for a pass that then threw halfway through it.
 */
export async function recordAgentPass(workspaceKey: string, at: number): Promise<void> {
  const sql = db();
  if (!sql) return;
  try {
    await ensure(sql);
    await sql`
      INSERT INTO agent_pass_log (workspace_key, last_run_at)
      VALUES (${workspaceKey}, ${at})
      ON CONFLICT (workspace_key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at`;
  } catch {
    // Bookkeeping must not fail a pass that worked.
  }
}
