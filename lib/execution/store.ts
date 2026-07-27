import { type Sql, RUNTIME_DDL } from "@/lib/db";
import { emptyExecutionState } from "./engine";
import type { AdaptationProposal, ExecutionState } from "./types";

// Persistence for execution. Same repository pattern as everywhere else: in-memory by
// default, Neon when a database is configured. Three small stores rather than one blob so a
// noisy activity feed never rewrites campaign state.

export interface ExecutionStateRepo {
  get(tenant: string, launchId: string): Promise<ExecutionState>;
  save(state: ExecutionState): Promise<ExecutionState>;
}

/** Dismissed notification ids → the time they were dismissed. */
export interface NotificationRepo {
  dismissed(tenant: string, launchId: string): Promise<Record<string, number>>;
  dismiss(tenant: string, launchId: string, id: string, at: number): Promise<void>;
}

export interface AdaptationRepo {
  decisions(tenant: string, launchId: string): Promise<Record<string, AdaptationProposal>>;
  record(tenant: string, launchId: string, p: AdaptationProposal): Promise<void>;
}

// ---- In-memory ----

export class InMemoryExecutionStateRepo implements ExecutionStateRepo {
  private m = new Map<string, ExecutionState>();
  private k(t: string, l: string) { return `${t}::${l}`; }
  async get(tenant: string, launchId: string) { return this.m.get(this.k(tenant, launchId)) ?? emptyExecutionState(tenant, launchId); }
  async save(state: ExecutionState) { this.m.set(this.k(state.tenant, state.launchId), state); return state; }
}

export class InMemoryNotificationRepo implements NotificationRepo {
  private m = new Map<string, Record<string, number>>();
  private k(t: string, l: string) { return `${t}::${l}`; }
  async dismissed(tenant: string, launchId: string) { return this.m.get(this.k(tenant, launchId)) ?? {}; }
  async dismiss(tenant: string, launchId: string, id: string, at: number) {
    const cur = this.m.get(this.k(tenant, launchId)) ?? {};
    cur[id] = at;
    this.m.set(this.k(tenant, launchId), cur);
  }
}

export class InMemoryAdaptationRepo implements AdaptationRepo {
  private m = new Map<string, Record<string, AdaptationProposal>>();
  private k(t: string, l: string) { return `${t}::${l}`; }
  async decisions(tenant: string, launchId: string) { return this.m.get(this.k(tenant, launchId)) ?? {}; }
  async record(tenant: string, launchId: string, p: AdaptationProposal) {
    const cur = this.m.get(this.k(tenant, launchId)) ?? {};
    cur[p.id] = p;
    this.m.set(this.k(tenant, launchId), cur);
  }
}

// ---- Neon ----

let ready = false;
async function ensureTables(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS execution_state (
    tenant TEXT NOT NULL, launch_id TEXT NOT NULL, state JSONB NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY (tenant, launch_id) )`;
  await sql`CREATE TABLE IF NOT EXISTS execution_notifications (
    tenant TEXT NOT NULL, launch_id TEXT NOT NULL, notification_id TEXT NOT NULL, dismissed_at BIGINT NOT NULL,
    PRIMARY KEY (tenant, launch_id, notification_id) )`;
  await sql`CREATE TABLE IF NOT EXISTS execution_adaptations (
    tenant TEXT NOT NULL, launch_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
    proposal JSONB NOT NULL, decided_at BIGINT,
    PRIMARY KEY (tenant, launch_id, proposal_id) )`;
  ready = true;
}

export class NeonExecutionStateRepo implements ExecutionStateRepo {
  constructor(private sql: Sql) {}
  async get(tenant: string, launchId: string) {
    await ensureTables(this.sql);
    const rows = await this.sql`SELECT state FROM execution_state
      WHERE tenant = ${tenant} AND launch_id = ${launchId}` as { state: ExecutionState }[];
    return rows[0]?.state ?? emptyExecutionState(tenant, launchId);
  }
  async save(state: ExecutionState) {
    await ensureTables(this.sql);
    await this.sql`INSERT INTO execution_state (tenant, launch_id, state, updated_at)
      VALUES (${state.tenant}, ${state.launchId}, ${JSON.stringify(state)}, ${state.updatedAt})
      ON CONFLICT (tenant, launch_id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`;
    return state;
  }
}

export class NeonNotificationRepo implements NotificationRepo {
  constructor(private sql: Sql) {}
  async dismissed(tenant: string, launchId: string) {
    await ensureTables(this.sql);
    const rows = await this.sql`SELECT notification_id, dismissed_at FROM execution_notifications
      WHERE tenant = ${tenant} AND launch_id = ${launchId}` as { notification_id: string; dismissed_at: number }[];
    return Object.fromEntries(rows.map((r) => [r.notification_id, Number(r.dismissed_at)]));
  }
  async dismiss(tenant: string, launchId: string, id: string, at: number) {
    await ensureTables(this.sql);
    await this.sql`INSERT INTO execution_notifications (tenant, launch_id, notification_id, dismissed_at)
      VALUES (${tenant}, ${launchId}, ${id}, ${at})
      ON CONFLICT (tenant, launch_id, notification_id) DO NOTHING`;
  }
}

export class NeonAdaptationRepo implements AdaptationRepo {
  constructor(private sql: Sql) {}
  async decisions(tenant: string, launchId: string) {
    await ensureTables(this.sql);
    const rows = await this.sql`SELECT proposal FROM execution_adaptations
      WHERE tenant = ${tenant} AND launch_id = ${launchId}` as { proposal: AdaptationProposal }[];
    return Object.fromEntries(rows.map((r) => [r.proposal.id, r.proposal]));
  }
  async record(tenant: string, launchId: string, p: AdaptationProposal) {
    await ensureTables(this.sql);
    await this.sql`INSERT INTO execution_adaptations (tenant, launch_id, proposal_id, proposal, decided_at)
      VALUES (${tenant}, ${launchId}, ${p.id}, ${JSON.stringify(p)}, ${p.decidedAt})
      ON CONFLICT (tenant, launch_id, proposal_id) DO UPDATE SET proposal = EXCLUDED.proposal, decided_at = EXCLUDED.decided_at`;
  }
}
