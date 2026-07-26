import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type {
  CompetitorProfile, MemoryRecord, MemoryRecordKind, Opportunity, Trend,
} from "./types";
import { idFrom, round } from "./util";

// MarketMemory — the historical record: what was trending, what competitors did, which
// campaigns worked, what audiences cared about, seasonality and past opportunities.
// Versioned on re-observation so history is never overwritten, mirroring how the Learning
// Engine treats its patterns.

export interface MarketMemoryStore {
  record(r: MemoryRecord): Promise<MemoryRecord>;
  list(tenant: string, kind?: MemoryRecordKind, limit?: number): Promise<MemoryRecord[]>;
  /** Same key over time — the history of one topic/competitor/keyword. */
  history(tenant: string, key: string): Promise<MemoryRecord[]>;
}

export function memoryRecord(
  tenant: string, kind: MemoryRecordKind, key: string, value: string,
  observedAt: number, performance: number | null = null,
): MemoryRecord {
  return { id: idFrom("mem", tenant, kind, key, observedAt), tenant, kind, key, value, performance, observedAt, version: 1 };
}

export class InMemoryMarketMemory implements MarketMemoryStore {
  private rows: MemoryRecord[] = [];
  async record(r: MemoryRecord) {
    const prev = this.rows.find((x) => x.tenant === r.tenant && x.kind === r.kind && x.key === r.key && x.observedAt === r.observedAt);
    if (prev) { prev.version += 1; prev.value = r.value; prev.performance = r.performance; return prev; }
    this.rows.push({ ...r });
    return r;
  }
  async list(tenant: string, kind?: MemoryRecordKind, limit = 200) {
    return this.rows
      .filter((r) => r.tenant === tenant && (!kind || r.kind === kind))
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, limit);
  }
  async history(tenant: string, key: string) {
    return this.rows.filter((r) => r.tenant === tenant && r.key === key).sort((a, b) => a.observedAt - b.observedAt);
  }
}

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS market_memory (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    performance REAL,
    observed_at BIGINT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_market_memory_tenant ON market_memory (tenant, kind, observed_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_market_memory_key ON market_memory (tenant, key, observed_at)`;
  ready = true;
}

export class NeonMarketMemory implements MarketMemoryStore {
  constructor(private sql: Sql) {}
  async record(r: MemoryRecord) {
    await ensureTable(this.sql);
    const rows = (await this.sql`
      INSERT INTO market_memory (id, tenant, kind, key, value, performance, observed_at, version)
      VALUES (${r.id}, ${r.tenant}, ${r.kind}, ${r.key}, ${r.value}, ${r.performance}, ${r.observedAt}, ${r.version})
      ON CONFLICT (id) DO UPDATE SET
        version = market_memory.version + 1,
        value = EXCLUDED.value,
        performance = COALESCE(EXCLUDED.performance, market_memory.performance)
      RETURNING id, tenant, kind, key, value, performance, observed_at, version`) as Record<string, unknown>[];
    return rows[0] ? rowTo(rows[0]) : r;
  }
  async list(tenant: string, kind?: MemoryRecordKind, limit = 200) {
    await ensureTable(this.sql);
    const rows = kind
      ? (await this.sql`SELECT * FROM market_memory WHERE tenant = ${tenant} AND kind = ${kind} ORDER BY observed_at DESC LIMIT ${limit}`) as Record<string, unknown>[]
      : (await this.sql`SELECT * FROM market_memory WHERE tenant = ${tenant} ORDER BY observed_at DESC LIMIT ${limit}`) as Record<string, unknown>[];
    return rows.map(rowTo);
  }
  async history(tenant: string, key: string) {
    await ensureTable(this.sql);
    const rows = (await this.sql`SELECT * FROM market_memory WHERE tenant = ${tenant} AND key = ${key} ORDER BY observed_at`) as Record<string, unknown>[];
    return rows.map(rowTo);
  }
}

function rowTo(r: Record<string, unknown>): MemoryRecord {
  return {
    id: String(r.id), tenant: String(r.tenant), kind: r.kind as MemoryRecordKind,
    key: String(r.key), value: String(r.value),
    performance: r.performance == null ? null : Number(r.performance),
    observedAt: Number(r.observed_at), version: Number(r.version),
  };
}

/** Persist a whole intelligence run — the shape MarketMemory is meant to accumulate. */
export async function remember(
  store: MarketMemoryStore, tenant: string, at: number,
  data: { trends?: Trend[]; competitors?: CompetitorProfile[]; opportunities?: Opportunity[] },
): Promise<number> {
  let n = 0;
  for (const t of data.trends ?? []) {
    await store.record(memoryRecord(tenant, "trend", t.topic, `${t.kind} · strength ${t.strength} · velocity ${t.velocity}`, at, t.confidence));
    n++;
  }
  for (const c of data.competitors ?? []) {
    await store.record(memoryRecord(tenant, "competitor", c.name, c.summary, at, round(c.avgEngagement)));
    n++;
  }
  for (const o of data.opportunities ?? []) {
    await store.record(memoryRecord(tenant, "opportunity", o.title, `${o.kind} · ${o.recommendedAction}`, at, o.confidence));
    n++;
  }
  return n;
}

/** Seasonality: which weeks of the year a topic historically peaked. */
export function seasonality(history: MemoryRecord[]): { week: number; strength: number }[] {
  const byWeek = new Map<number, number[]>();
  for (const r of history) {
    const d = new Date(r.observedAt);
    const week = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
    (byWeek.get(week) ?? byWeek.set(week, []).get(week)!).push(r.performance ?? 0);
  }
  return [...byWeek.entries()]
    .map(([week, xs]) => ({ week, strength: round(xs.reduce((s, x) => s + x, 0) / xs.length) }))
    .sort((a, b) => b.strength - a.strength || a.week - b.week);
}
