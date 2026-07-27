import { createHash } from "node:crypto";
import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type { ActivityEvent, ActivityKind } from "./types";

// ExecutionHistory — the append-only activity stream behind the live feed.
//
// Append-only on purpose: "what happened during this launch" is the record a founder trusts
// when a post goes out at the wrong time. Nothing edits or deletes an event.

let seq = 0;

export function activityEvent(input: {
  tenant: string; launchId: string; campaignId?: string | null;
  kind: ActivityKind; message: string; at: number;
  meta?: ActivityEvent["meta"];
}): ActivityEvent {
  const id = "act_" + createHash("sha256")
    .update(`${input.tenant}|${input.launchId}|${input.campaignId ?? ""}|${input.kind}|${input.message}|${input.at}|${seq++}`)
    .digest("hex").slice(0, 16);
  return {
    id, tenant: input.tenant, launchId: input.launchId, campaignId: input.campaignId ?? null,
    kind: input.kind, message: input.message, at: input.at, meta: input.meta ?? {},
  };
}

export interface ExecutionHistoryStore {
  append(e: ActivityEvent): Promise<void>;
  list(tenant: string, launchId: string, limit?: number): Promise<ActivityEvent[]>;
  /** Events after a cursor — how the live feed polls without re-reading everything. */
  since(tenant: string, launchId: string, at: number, limit?: number): Promise<ActivityEvent[]>;
}

export class InMemoryExecutionHistory implements ExecutionHistoryStore {
  private events: ActivityEvent[] = [];
  private cap = 2000;

  async append(e: ActivityEvent) {
    this.events.push(e);
    if (this.events.length > this.cap) this.events.splice(0, this.events.length - this.cap);
  }
  async list(tenant: string, launchId: string, limit = 50) {
    return this.events.filter((e) => e.tenant === tenant && e.launchId === launchId).slice(-limit).reverse();
  }
  async since(tenant: string, launchId: string, at: number, limit = 50) {
    return this.events.filter((e) => e.tenant === tenant && e.launchId === launchId && e.at > at).slice(-limit).reverse();
  }
}

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS execution_activity (
    id TEXT PRIMARY KEY, tenant TEXT NOT NULL, launch_id TEXT NOT NULL, campaign_id TEXT,
    kind TEXT NOT NULL, message TEXT NOT NULL, at BIGINT NOT NULL, meta JSONB NOT NULL )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_execution_activity_feed ON execution_activity (tenant, launch_id, at DESC)`;
  ready = true;
}

export class NeonExecutionHistory implements ExecutionHistoryStore {
  constructor(private sql: Sql) {}

  async append(e: ActivityEvent) {
    await ensureTable(this.sql);
    await this.sql`INSERT INTO execution_activity (id, tenant, launch_id, campaign_id, kind, message, at, meta)
      VALUES (${e.id}, ${e.tenant}, ${e.launchId}, ${e.campaignId}, ${e.kind}, ${e.message}, ${e.at}, ${JSON.stringify(e.meta)})
      ON CONFLICT (id) DO NOTHING`;
  }

  private map(rows: Record<string, unknown>[]): ActivityEvent[] {
    return rows.map((r) => ({
      id: String(r.id), tenant: String(r.tenant), launchId: String(r.launch_id),
      campaignId: r.campaign_id == null ? null : String(r.campaign_id),
      kind: String(r.kind) as ActivityKind, message: String(r.message),
      at: Number(r.at), meta: (r.meta ?? {}) as ActivityEvent["meta"],
    }));
  }

  async list(tenant: string, launchId: string, limit = 50) {
    await ensureTable(this.sql);
    return this.map(await this.sql`SELECT * FROM execution_activity
      WHERE tenant = ${tenant} AND launch_id = ${launchId} ORDER BY at DESC LIMIT ${limit}` as Record<string, unknown>[]);
  }

  async since(tenant: string, launchId: string, at: number, limit = 50) {
    await ensureTable(this.sql);
    return this.map(await this.sql`SELECT * FROM execution_activity
      WHERE tenant = ${tenant} AND launch_id = ${launchId} AND at > ${at}
      ORDER BY at DESC LIMIT ${limit}` as Record<string, unknown>[]);
  }
}
