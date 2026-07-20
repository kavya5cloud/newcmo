import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type { PlatformId, PublishRecord, PublishStatus } from "./types";

// Publishing History (Part 8) — the durable log of every publish attempt: provider,
// platform, time, version, retries, failures, rollback, published/preview URLs, and a
// metrics placeholder the Learning Engine (next milestone) will populate. Repository
// pattern: in-memory for tests, Neon in prod.

export interface PublishingHistoryStore {
  record(rec: PublishRecord): Promise<PublishRecord>;
  list(assetKey?: string): Promise<PublishRecord[]>;
}

export class InMemoryHistoryStore implements PublishingHistoryStore {
  private records: PublishRecord[] = [];
  async record(rec: PublishRecord) { this.records.push(rec); return rec; }
  async list(assetKey?: string) {
    return assetKey ? this.records.filter((r) => r.assetKey === assetKey) : [...this.records];
  }
}

let histReady = false;
async function ensureHistoryTable(sql: Sql) {
  if (histReady) return;
  if (!RUNTIME_DDL) { histReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS pub_history (
    id TEXT PRIMARY KEY,
    asset_key TEXT NOT NULL,
    platform TEXT NOT NULL,
    provider TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    at BIGINT NOT NULL,
    retries INT NOT NULL DEFAULT 0,
    failures INT NOT NULL DEFAULT 0,
    rolled_back BOOLEAN NOT NULL DEFAULT false,
    published_url TEXT,
    preview_url TEXT,
    status TEXT NOT NULL,
    metrics JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pub_history_asset ON pub_history (asset_key, at)`;
  histReady = true;
}

export class NeonHistoryStore implements PublishingHistoryStore {
  constructor(private sql: Sql) {}
  async record(rec: PublishRecord) {
    await ensureHistoryTable(this.sql);
    await this.sql`INSERT INTO pub_history
      (id, asset_key, platform, provider, version, at, retries, failures, rolled_back, published_url, preview_url, status, metrics)
      VALUES (${rec.id}, ${rec.assetKey}, ${rec.platform}, ${rec.provider}, ${rec.version}, ${rec.at},
              ${rec.retries}, ${rec.failures}, ${rec.rolledBack}, ${rec.publishedUrl}, ${rec.previewUrl},
              ${rec.status}, ${rec.metrics ? JSON.stringify(rec.metrics) : null})
      ON CONFLICT (id) DO NOTHING`;
    return rec;
  }
  async list(assetKey?: string) {
    await ensureHistoryTable(this.sql);
    const rows = assetKey
      ? (await this.sql`SELECT * FROM pub_history WHERE asset_key = ${assetKey} ORDER BY at`) as Record<string, unknown>[]
      : (await this.sql`SELECT * FROM pub_history ORDER BY at DESC LIMIT 500`) as Record<string, unknown>[];
    return rows.map((r): PublishRecord => ({
      id: String(r.id), assetKey: String(r.asset_key), platform: r.platform as PlatformId, provider: String(r.provider),
      version: Number(r.version), at: Number(r.at), retries: Number(r.retries), failures: Number(r.failures),
      rolledBack: Boolean(r.rolled_back), publishedUrl: (r.published_url as string) ?? null,
      previewUrl: (r.preview_url as string) ?? null, status: r.status as PublishStatus,
      metrics: (r.metrics as Record<string, number>) ?? null,
    }));
  }
}
