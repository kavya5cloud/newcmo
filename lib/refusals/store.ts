import { randomUUID } from "node:crypto";
import { db, RUNTIME_DDL, type Sql } from "@/lib/db";
import type { NewRefusal, Refusal, Verdict } from "./types";

// Where refusals live.
//
// Same shape as every other store here: one interface, an in-memory implementation that the
// tests and an unconfigured environment use, and a Neon one for production. Callers ask
// refusalRepo() and never learn which they got.

export interface RefusalRepo {
  record(r: NewRefusal): Promise<Refusal>;
  list(workspaceKey: string, limit?: number): Promise<Refusal[]>;
  /** Refusals whose checkable date has passed and which have no verdict yet. */
  due(workspaceKey: string, now: number): Promise<Refusal[]>;
  resolve(id: string, verdict: Verdict, evidence: string, at: number): Promise<void>;
}

class InMemoryRefusalRepo implements RefusalRepo {
  private rows: Refusal[] = [];

  async record(r: NewRefusal): Promise<Refusal> {
    const row: Refusal = { ...r, id: randomUUID(), verdict: "unknown", evidence: null, createdAt: Date.now(), resolvedAt: null };
    this.rows.unshift(row);
    return row;
  }
  async list(workspaceKey: string, limit = 100): Promise<Refusal[]> {
    return this.rows.filter((r) => r.workspaceKey === workspaceKey).slice(0, limit);
  }
  async due(workspaceKey: string, now: number): Promise<Refusal[]> {
    return this.rows.filter(
      (r) => r.workspaceKey === workspaceKey && r.verdict === "unknown" && r.checkableAt != null && r.checkableAt <= now,
    );
  }
  async resolve(id: string, verdict: Verdict, evidence: string, at: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) { row.verdict = verdict; row.evidence = evidence; row.resolvedAt = at; }
  }
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS refusals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    proposed TEXT NOT NULL,
    channel TEXT NOT NULL,
    reason TEXT NOT NULL,
    explanation TEXT NOT NULL,
    instead_did TEXT,
    checkable_at TIMESTAMPTZ,
    verdict TEXT NOT NULL DEFAULT 'unknown',
    evidence TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_refusals_ws ON refusals (workspace_key, created_at DESC)`;
  // The grading pass asks for exactly this: unresolved, and now checkable. Without the index
  // it is a full scan on a table that only ever grows.
  await sql`CREATE INDEX IF NOT EXISTS idx_refusals_due ON refusals (workspace_key, verdict, checkable_at)`;
  ready = true;
}

type Row = {
  id: string; workspace_key: string; proposed: string; channel: string; reason: string;
  explanation: string; instead_did: string | null; checkable_at: string | null;
  verdict: string; evidence: string | null; created_at: string; resolved_at: string | null;
};

const toRefusal = (r: Row): Refusal => ({
  id: r.id,
  workspaceKey: r.workspace_key,
  proposed: r.proposed,
  channel: r.channel,
  reason: r.reason as Refusal["reason"],
  explanation: r.explanation,
  insteadDid: r.instead_did,
  checkableAt: r.checkable_at ? new Date(r.checkable_at).getTime() : null,
  verdict: r.verdict as Verdict,
  evidence: r.evidence,
  createdAt: new Date(r.created_at).getTime(),
  resolvedAt: r.resolved_at ? new Date(r.resolved_at).getTime() : null,
});

class NeonRefusalRepo implements RefusalRepo {
  constructor(private sql: Sql) {}

  async record(r: NewRefusal): Promise<Refusal> {
    await ensure(this.sql);
    const rows = (await this.sql`
      INSERT INTO refusals (workspace_key, proposed, channel, reason, explanation, instead_did, checkable_at)
      VALUES (${r.workspaceKey}, ${r.proposed}, ${r.channel}, ${r.reason}, ${r.explanation}, ${r.insteadDid},
              ${r.checkableAt ? new Date(r.checkableAt).toISOString() : null})
      RETURNING *`) as Row[];
    return toRefusal(rows[0]);
  }

  async list(workspaceKey: string, limit = 100): Promise<Refusal[]> {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT * FROM refusals WHERE workspace_key = ${workspaceKey}
      ORDER BY created_at DESC LIMIT ${limit}`) as Row[];
    return rows.map(toRefusal);
  }

  async due(workspaceKey: string, now: number): Promise<Refusal[]> {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT * FROM refusals
      WHERE workspace_key = ${workspaceKey} AND verdict = 'unknown'
        AND checkable_at IS NOT NULL AND checkable_at <= ${new Date(now).toISOString()}
      ORDER BY checkable_at ASC LIMIT 200`) as Row[];
    return rows.map(toRefusal);
  }

  async resolve(id: string, verdict: Verdict, evidence: string, at: number): Promise<void> {
    await ensure(this.sql);
    // Only from unknown. A verdict is written once — re-grading a resolved refusal is how a
    // ledger quietly improves its own record over time, which is the failure this exists to
    // avoid being accused of.
    await this.sql`
      UPDATE refusals SET verdict = ${verdict}, evidence = ${evidence}, resolved_at = ${new Date(at).toISOString()}
      WHERE id = ${id} AND verdict = 'unknown'`;
  }
}

let memo: RefusalRepo | null = null;
export function refusalRepo(): RefusalRepo {
  if (memo) return memo;
  const sql = db();
  memo = sql ? new NeonRefusalRepo(sql) : new InMemoryRefusalRepo();
  return memo;
}

/** Tests need a fresh repo per case; nothing else should call this. */
export function resetRefusalRepoForTests(): void {
  memo = null;
}
