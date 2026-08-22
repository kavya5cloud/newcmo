import { db, RUNTIME_DDL, type Sql } from "@/lib/db";

// Proof the publisher is alive.
//
// The publishing pass runs on a GitHub Actions schedule and logs what it did. Nothing was
// written down, so the application had no way to know whether it had run in the last ten
// minutes or the last three weeks — and the workflow's own comment says the quiet part:
// a green run means the endpoint answered, not that anything was published.
//
// So a founder could see "next post tomorrow 09:00", the schedule could be switched off or
// the secret rotated, and the product would keep saying the same thing forever. This is one
// row, updated every pass, so that claim can be checked instead of assumed.

export type Heartbeat = {
  at: number;
  /** Slots handed to the publishing engine on that pass. Zero is normal and common. */
  dispatched: number;
  /** Tenants examined. Distinguishes "nothing due" from "nobody configured". */
  tenants: number;
};

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS publisher_heartbeat (
    id BOOLEAN PRIMARY KEY DEFAULT true,
    at BIGINT NOT NULL,
    dispatched INT NOT NULL DEFAULT 0,
    tenants INT NOT NULL DEFAULT 0,
    CONSTRAINT one_row CHECK (id)
  )`;
  ready = true;
}

/** Record that a publishing pass completed. Never throws: bookkeeping must not fail a run. */
export async function recordHeartbeat(beat: Heartbeat): Promise<void> {
  const sql = db();
  if (!sql) return;
  try {
    await ensure(sql);
    await sql`
      INSERT INTO publisher_heartbeat (id, at, dispatched, tenants)
      VALUES (true, ${beat.at}, ${beat.dispatched}, ${beat.tenants})
      ON CONFLICT (id) DO UPDATE SET
        at = EXCLUDED.at, dispatched = EXCLUDED.dispatched, tenants = EXCLUDED.tenants`;
  } catch {
    // A publishing pass that worked must not be reported as failed because a status row
    // could not be written.
  }
}

/** The last completed pass, or null when none has ever been recorded. */
export async function lastHeartbeat(): Promise<Heartbeat | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`SELECT at, dispatched, tenants FROM publisher_heartbeat WHERE id = true`) as
      { at: string | number; dispatched: number; tenants: number }[];
    if (!rows[0]) return null;
    return { at: Number(rows[0].at), dispatched: rows[0].dispatched, tenants: rows[0].tenants };
  } catch {
    return null;
  }
}

/**
 * How long a silence means something is wrong.
 *
 * The schedule is every ten minutes. Thirty allows two missed runs before anyone is told,
 * because GitHub Actions delays scheduled jobs under load routinely and an alarm that cries
 * at the first late run is an alarm nobody reads.
 */
export const STALE_AFTER_MS = 30 * 60_000;

export function isStale(beat: Heartbeat | null, now: number): boolean {
  return !beat || now - beat.at > STALE_AFTER_MS;
}
