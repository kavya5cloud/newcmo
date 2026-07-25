import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type { ConnectedAccount, Draft, PublishHistoryEntry, PublishJob, SocialPlatform } from "./types";

// Persistence for the Cross-Platform Publishing System — connected accounts, drafts,
// publishing jobs / scheduled posts, and publish history. Repository pattern: in-memory
// (default/tests) + Neon (durable). Append-only history.

export interface AccountStore { save(a: ConnectedAccount): Promise<void>; get(id: string): Promise<ConnectedAccount | null>; list(tenant: string): Promise<ConnectedAccount[]>; remove(id: string): Promise<void>; }
export interface DraftStore { save(d: Draft): Promise<void>; get(id: string): Promise<Draft | null>; list(tenant: string): Promise<Draft[]>; remove(id: string): Promise<void>; }
export interface JobStore { save(j: PublishJob): Promise<void>; get(id: string): Promise<PublishJob | null>; list(tenant?: string): Promise<PublishJob[]>; }
export interface HistoryStore { append(e: PublishHistoryEntry): Promise<void>; list(tenant: string, limit?: number): Promise<PublishHistoryEntry[]>; }

// ---- In-memory ----

export class InMemoryAccountStore implements AccountStore {
  private m = new Map<string, ConnectedAccount>();
  async save(a: ConnectedAccount) { this.m.set(a.id, a); }
  async get(id: string) { return this.m.get(id) ?? null; }
  async list(tenant: string) { return [...this.m.values()].filter((a) => a.tenant === tenant); }
  async remove(id: string) { this.m.delete(id); }
}
export class InMemoryDraftStore implements DraftStore {
  private m = new Map<string, Draft>();
  async save(d: Draft) { this.m.set(d.id, d); }
  async get(id: string) { return this.m.get(id) ?? null; }
  async list(tenant: string) { return [...this.m.values()].filter((d) => d.tenant === tenant).sort((a, b) => b.updatedAt - a.updatedAt); }
  async remove(id: string) { this.m.delete(id); }
}
export class InMemoryJobStore implements JobStore {
  private m = new Map<string, PublishJob>();
  async save(j: PublishJob) { this.m.set(j.id, { ...j }); }
  async get(id: string) { const j = this.m.get(id); return j ? { ...j } : null; }
  async list(tenant?: string) { return [...this.m.values()].filter((j) => !tenant || j.tenant === tenant).sort((a, b) => b.createdAt - a.createdAt); }
}
export class InMemoryHistoryStore implements HistoryStore {
  private a: PublishHistoryEntry[] = [];
  async append(e: PublishHistoryEntry) { this.a.push(e); }
  async list(tenant: string, limit = 200) { return this.a.filter((e) => e.tenant === tenant).slice(-limit).reverse(); }
}

// ---- Neon ----

let ready = false;
async function ensureTables(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY, tenant TEXT NOT NULL, platform TEXT NOT NULL, handle TEXT NOT NULL,
    external_id TEXT NOT NULL, status TEXT NOT NULL, token_expires_at BIGINT,
    data JSONB NOT NULL, connected_at BIGINT NOT NULL )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_accounts_tenant ON social_accounts (tenant)`;
  await sql`CREATE TABLE IF NOT EXISTS social_drafts (
    id TEXT PRIMARY KEY, tenant TEXT NOT NULL, title TEXT NOT NULL, data JSONB NOT NULL, updated_at BIGINT NOT NULL )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_drafts_tenant ON social_drafts (tenant, updated_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS social_jobs (
    id TEXT PRIMARY KEY, tenant TEXT NOT NULL, account_id TEXT NOT NULL, platform TEXT NOT NULL,
    state TEXT NOT NULL, scheduled_at BIGINT, attempts INT NOT NULL DEFAULT 0,
    data JSONB NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_jobs_state ON social_jobs (state, scheduled_at)`;
  await sql`CREATE TABLE IF NOT EXISTS social_history (
    id TEXT PRIMARY KEY, tenant TEXT NOT NULL, job_id TEXT NOT NULL, account_id TEXT NOT NULL,
    platform TEXT NOT NULL, state TEXT NOT NULL, external_id TEXT, permalink TEXT,
    attempts INT NOT NULL DEFAULT 0, published_at BIGINT, error TEXT )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_history_tenant ON social_history (tenant, published_at DESC)`;
  ready = true;
}

export class NeonAccountStore implements AccountStore {
  constructor(private sql: Sql) {}
  async save(a: ConnectedAccount) {
    await ensureTables(this.sql);
    await this.sql`INSERT INTO social_accounts (id, tenant, platform, handle, external_id, status, token_expires_at, data, connected_at)
      VALUES (${a.id}, ${a.tenant}, ${a.platform}, ${a.handle}, ${a.externalId}, ${a.status}, ${a.tokenExpiresAt}, ${JSON.stringify(a)}::jsonb, ${a.connectedAt})
      ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, token_expires_at = EXCLUDED.token_expires_at, data = EXCLUDED.data`;
  }
  async get(id: string) { await ensureTables(this.sql); const r = (await this.sql`SELECT data FROM social_accounts WHERE id = ${id}`) as { data: ConnectedAccount }[]; return r[0]?.data ?? null; }
  async list(tenant: string) { await ensureTables(this.sql); const r = (await this.sql`SELECT data FROM social_accounts WHERE tenant = ${tenant} ORDER BY connected_at DESC`) as { data: ConnectedAccount }[]; return r.map((x) => x.data); }
  async remove(id: string) { await ensureTables(this.sql); await this.sql`DELETE FROM social_accounts WHERE id = ${id}`; }
}
export class NeonDraftStore implements DraftStore {
  constructor(private sql: Sql) {}
  async save(d: Draft) { await ensureTables(this.sql); await this.sql`INSERT INTO social_drafts (id, tenant, title, data, updated_at) VALUES (${d.id}, ${d.tenant}, ${d.title}, ${JSON.stringify(d)}::jsonb, ${d.updatedAt}) ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`; }
  async get(id: string) { await ensureTables(this.sql); const r = (await this.sql`SELECT data FROM social_drafts WHERE id = ${id}`) as { data: Draft }[]; return r[0]?.data ?? null; }
  async list(tenant: string) { await ensureTables(this.sql); const r = (await this.sql`SELECT data FROM social_drafts WHERE tenant = ${tenant} ORDER BY updated_at DESC LIMIT 200`) as { data: Draft }[]; return r.map((x) => x.data); }
  async remove(id: string) { await ensureTables(this.sql); await this.sql`DELETE FROM social_drafts WHERE id = ${id}`; }
}
export class NeonJobStore implements JobStore {
  constructor(private sql: Sql) {}
  async save(j: PublishJob) { await ensureTables(this.sql); await this.sql`INSERT INTO social_jobs (id, tenant, account_id, platform, state, scheduled_at, attempts, data, created_at, updated_at) VALUES (${j.id}, ${j.tenant}, ${j.accountId}, ${j.platform}, ${j.state}, ${j.scheduledAt}, ${j.attempts}, ${JSON.stringify(j)}::jsonb, ${j.createdAt}, ${j.updatedAt}) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, scheduled_at = EXCLUDED.scheduled_at, attempts = EXCLUDED.attempts, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`; }
  async get(id: string) { await ensureTables(this.sql); const r = (await this.sql`SELECT data FROM social_jobs WHERE id = ${id}`) as { data: PublishJob }[]; return r[0]?.data ?? null; }
  async list(tenant?: string) { await ensureTables(this.sql); const r = tenant ? (await this.sql`SELECT data FROM social_jobs WHERE tenant = ${tenant} ORDER BY created_at DESC LIMIT 300`) as { data: PublishJob }[] : (await this.sql`SELECT data FROM social_jobs ORDER BY created_at DESC LIMIT 300`) as { data: PublishJob }[]; return r.map((x) => x.data); }
}
export class NeonHistoryStore implements HistoryStore {
  constructor(private sql: Sql) {}
  async append(e: PublishHistoryEntry) { await ensureTables(this.sql); await this.sql`INSERT INTO social_history (id, tenant, job_id, account_id, platform, state, external_id, permalink, attempts, published_at, error) VALUES (${e.id}, ${e.tenant}, ${e.jobId}, ${e.accountId}, ${e.platform}, ${e.state}, ${e.externalId}, ${e.permalink}, ${e.attempts}, ${e.publishedAt}, ${e.error}) ON CONFLICT (id) DO NOTHING`; }
  async list(tenant: string, limit = 200) {
    await ensureTables(this.sql);
    const rows = (await this.sql`SELECT * FROM social_history WHERE tenant = ${tenant} ORDER BY published_at DESC NULLS LAST LIMIT ${limit}`) as Record<string, unknown>[];
    return rows.map((r): PublishHistoryEntry => ({ id: String(r.id), tenant: String(r.tenant), jobId: String(r.job_id), accountId: String(r.account_id), platform: r.platform as SocialPlatform, state: r.state as PublishHistoryEntry["state"], externalId: (r.external_id as string) ?? null, permalink: (r.permalink as string) ?? null, attempts: Number(r.attempts), publishedAt: r.published_at == null ? null : Number(r.published_at), error: (r.error as string) ?? null }));
  }
}
