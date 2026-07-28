import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type { Automation, QueueItem } from "./types";

// Persistence for automations and their queue.
//
// The queue is the record of what was promised and what happened, so it is stored per
// slot rather than as one blob: the cron updates a handful of rows a minute, and a
// blob would make every write a whole-queue rewrite and every concurrent run a
// last-writer-wins race.

export interface AutomationRepo {
  listAutomations(tenant: string): Promise<Automation[]>;
  saveAutomation(a: Automation): Promise<void>;
  listQueue(tenant: string, limit?: number): Promise<QueueItem[]>;
  saveQueue(items: QueueItem[]): Promise<void>;
  /** Tenants with at least one active automation — what the cron iterates. */
  activeTenants(): Promise<string[]>;
}

export class InMemoryAutomationRepo implements AutomationRepo {
  private autos = new Map<string, Automation>();
  private queue = new Map<string, QueueItem>();
  async listAutomations(tenant: string) { return [...this.autos.values()].filter((a) => a.tenant === tenant); }
  async saveAutomation(a: Automation) { this.autos.set(a.id, a); }
  async listQueue(tenant: string, limit = 500) {
    return [...this.queue.values()].filter((q) => q.tenant === tenant).sort((a, b) => a.at - b.at).slice(0, limit);
  }
  async saveQueue(items: QueueItem[]) { for (const i of items) this.queue.set(i.id, i); }
  async activeTenants() { return [...new Set([...this.autos.values()].filter((a) => a.active).map((a) => a.tenant))]; }
}

let ready = false;
async function ensureTables(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY, tenant TEXT NOT NULL, data JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true, updated_at BIGINT NOT NULL )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_automations_tenant ON automations (tenant)`;
  await sql`CREATE TABLE IF NOT EXISTS automation_queue (
    id TEXT PRIMARY KEY, tenant TEXT NOT NULL, automation_id TEXT NOT NULL,
    at BIGINT NOT NULL, state TEXT NOT NULL, data JSONB NOT NULL )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_automation_queue_due ON automation_queue (tenant, state, at)`;
  ready = true;
}

export class NeonAutomationRepo implements AutomationRepo {
  constructor(private sql: Sql) {}

  async listAutomations(tenant: string) {
    await ensureTables(this.sql);
    const rows = await this.sql`SELECT data FROM automations WHERE tenant = ${tenant}` as { data: Automation }[];
    return rows.map((r) => r.data);
  }

  async saveAutomation(a: Automation) {
    await ensureTables(this.sql);
    await this.sql`INSERT INTO automations (id, tenant, data, active, updated_at)
      VALUES (${a.id}, ${a.tenant}, ${JSON.stringify(a)}, ${a.active}, ${a.updatedAt})
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, active = EXCLUDED.active, updated_at = EXCLUDED.updated_at`;
  }

  async listQueue(tenant: string, limit = 500) {
    await ensureTables(this.sql);
    const rows = await this.sql`SELECT data FROM automation_queue WHERE tenant = ${tenant}
      ORDER BY at ASC LIMIT ${limit}` as { data: QueueItem }[];
    return rows.map((r) => r.data);
  }

  async saveQueue(items: QueueItem[]) {
    await ensureTables(this.sql);
    for (const i of items) {
      await this.sql`INSERT INTO automation_queue (id, tenant, automation_id, at, state, data)
        VALUES (${i.id}, ${i.tenant}, ${i.automationId}, ${i.at}, ${i.state}, ${JSON.stringify(i)})
        ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, at = EXCLUDED.at, data = EXCLUDED.data`;
    }
  }

  async activeTenants() {
    await ensureTables(this.sql);
    const rows = await this.sql`SELECT DISTINCT tenant FROM automations WHERE active = true` as { tenant: string }[];
    return rows.map((r) => r.tenant);
  }
}
