import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type { UgcPackage } from "./types";

// Persistence for UGC packages. Same repository pattern as everywhere else.

export interface UgcRepo {
  save(pkg: UgcPackage): Promise<UgcPackage>;
  get(tenant: string, id: string): Promise<UgcPackage | null>;
  list(tenant: string, limit?: number): Promise<UgcPackage[]>;
}

export class InMemoryUgcRepo implements UgcRepo {
  private m = new Map<string, UgcPackage>();
  private k(t: string, id: string) { return `${t}::${id}`; }
  async save(pkg: UgcPackage) { this.m.set(this.k(pkg.tenant, pkg.id), pkg); return pkg; }
  async get(tenant: string, id: string) { return this.m.get(this.k(tenant, id)) ?? null; }
  async list(tenant: string, limit = 30) {
    return [...this.m.values()].filter((p) => p.tenant === tenant).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }
}

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS ugc_packages (
    id TEXT NOT NULL, tenant TEXT NOT NULL, data JSONB NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY (tenant, id) )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ugc_tenant ON ugc_packages (tenant, updated_at DESC)`;
  ready = true;
}

export class NeonUgcRepo implements UgcRepo {
  constructor(private sql: Sql) {}
  async save(pkg: UgcPackage) {
    await ensureTable(this.sql);
    await this.sql`INSERT INTO ugc_packages (id, tenant, data, updated_at)
      VALUES (${pkg.id}, ${pkg.tenant}, ${JSON.stringify(pkg)}, ${pkg.updatedAt})
      ON CONFLICT (tenant, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`;
    return pkg;
  }
  async get(tenant: string, id: string) {
    await ensureTable(this.sql);
    const rows = await this.sql`SELECT data FROM ugc_packages WHERE tenant = ${tenant} AND id = ${id}` as { data: UgcPackage }[];
    return rows[0]?.data ?? null;
  }
  async list(tenant: string, limit = 30) {
    await ensureTable(this.sql);
    const rows = await this.sql`SELECT data FROM ugc_packages WHERE tenant = ${tenant}
      ORDER BY updated_at DESC LIMIT ${limit}` as { data: UgcPackage }[];
    return rows.map((r) => r.data);
  }
}
