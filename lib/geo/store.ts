import { db, ensureSchema, RUNTIME_DDL, type Sql } from "@/lib/db";
import type { CitationReport } from "./types";

// Persisting citation checks.
//
// The whole value of this feature is the second run: one report tells you that you are not
// named today, a series tells you whether anything you did changed that. So reports are
// appended, never overwritten.
//
// Follows the repository pattern used everywhere else — an in-memory implementation so the
// feature works and is testable with no database, and a Neon one for production.

export interface CitationRepo {
  save(report: CitationReport): Promise<void>;
  latest(tenant: string): Promise<CitationReport | null>;
  history(tenant: string, limit?: number): Promise<CitationReport[]>;
}

export class InMemoryCitationRepo implements CitationRepo {
  private rows: CitationReport[] = [];

  async save(report: CitationReport) {
    this.rows.push(report);
  }
  async latest(tenant: string) {
    const mine = this.rows.filter((r) => r.tenant === tenant);
    return mine.length ? mine[mine.length - 1] : null;
  }
  async history(tenant: string, limit = 20) {
    return this.rows.filter((r) => r.tenant === tenant).slice(-limit).reverse();
  }
}

async function ensureTable(sql: Sql) {
  if (!RUNTIME_DDL) return;
  await sql`
    CREATE TABLE IF NOT EXISTS geo_citation_reports (
      id BIGSERIAL PRIMARY KEY,
      tenant TEXT NOT NULL,
      brand TEXT NOT NULL,
      host TEXT NOT NULL,
      engine TEXT NOT NULL,
      checked_at BIGINT NOT NULL,
      checks JSONB NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS geo_reports_tenant_time ON geo_citation_reports (tenant, checked_at DESC)`;
}

type Row = { tenant: string; brand: string; host: string; engine: string; checked_at: string | number; checks: unknown };

function toReport(r: Row): CitationReport {
  return {
    tenant: r.tenant,
    brand: r.brand,
    host: r.host,
    engine: r.engine,
    checkedAt: Number(r.checked_at),
    checks: (r.checks as CitationReport["checks"]) || [],
  };
}

export class NeonCitationRepo implements CitationRepo {
  constructor(private sql: Sql) {}

  async save(report: CitationReport) {
    await ensureSchema(this.sql);
    await ensureTable(this.sql);
    await this.sql`
      INSERT INTO geo_citation_reports (tenant, brand, host, engine, checked_at, checks)
      VALUES (${report.tenant}, ${report.brand}, ${report.host}, ${report.engine},
              ${report.checkedAt}, ${JSON.stringify(report.checks)}::jsonb)`;
  }

  async latest(tenant: string) {
    await ensureSchema(this.sql);
    await ensureTable(this.sql);
    const rows = (await this.sql`
      SELECT tenant, brand, host, engine, checked_at, checks FROM geo_citation_reports
      WHERE tenant = ${tenant} ORDER BY checked_at DESC LIMIT 1`) as Row[];
    return rows.length ? toReport(rows[0]) : null;
  }

  async history(tenant: string, limit = 20) {
    await ensureSchema(this.sql);
    await ensureTable(this.sql);
    const rows = (await this.sql`
      SELECT tenant, brand, host, engine, checked_at, checks FROM geo_citation_reports
      WHERE tenant = ${tenant} ORDER BY checked_at DESC LIMIT ${limit}`) as Row[];
    return rows.map(toReport);
  }
}

let memo: CitationRepo | null = null;

/** One repo per process, chosen by whether a database is reachable. */
export function citationRepo(): CitationRepo {
  if (memo) return memo;
  const sql = db();
  memo = sql ? new NeonCitationRepo(sql) : new InMemoryCitationRepo();
  return memo;
}
