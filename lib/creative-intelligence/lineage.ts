import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type { AssetLineage, GenerationSpecification } from "./types";

// Asset Lineage (Part 10) — every generated asset records the exact intelligence that
// produced it (spec, story, visual plan, hook, script, provider, model, cost, latency,
// approval, performance). Regenerations reuse the lineage so a re-render stays on-brand.

export function lineageFrom(
  assetId: string,
  spec: GenerationSpecification,
  outcome: Partial<Omit<AssetLineage, "assetId" | "specification" | "storyId" | "visualPlan" | "hookId" | "scriptId">> = {},
): AssetLineage {
  return {
    assetId,
    specification: spec,
    storyId: spec.storyStructure?.id ?? null,
    visualPlan: spec.visualDirection ?? null,
    hookId: spec.hook?.id ?? null,
    scriptId: spec.script?.id ?? null,
    provider: outcome.provider ?? null,
    modelVersion: outcome.modelVersion ?? null,
    cost: outcome.cost ?? null,
    latencyMs: outcome.latencyMs ?? null,
    approval: outcome.approval ?? null,
    performance: outcome.performance ?? null,
  };
}

/** Reuse a prior lineage's specification for a regeneration (bumps the spec version). */
export function specForRegeneration(lineage: AssetLineage): GenerationSpecification {
  return { ...lineage.specification, version: lineage.specification.version + 1 };
}

// ---- Repository pattern ----

export interface LineageStore {
  record(l: AssetLineage): Promise<AssetLineage>;
  get(assetId: string): Promise<AssetLineage | null>;
}

export class InMemoryLineageStore implements LineageStore {
  private map = new Map<string, AssetLineage>();
  async record(l: AssetLineage) { this.map.set(l.assetId, l); return l; }
  async get(assetId: string) { return this.map.get(assetId) ?? null; }
}

let lineageReady = false;
async function ensureLineageTable(sql: Sql) {
  if (lineageReady) return;
  if (!RUNTIME_DDL) { lineageReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS ci_asset_lineage (
    asset_id TEXT PRIMARY KEY,
    spec_id TEXT NOT NULL,
    provider TEXT,
    model_version TEXT,
    cost REAL,
    latency_ms INT,
    approval TEXT,
    performance REAL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  lineageReady = true;
}

export class NeonLineageStore implements LineageStore {
  constructor(private sql: Sql) {}
  async record(l: AssetLineage) {
    await ensureLineageTable(this.sql);
    await this.sql`INSERT INTO ci_asset_lineage
      (asset_id, spec_id, provider, model_version, cost, latency_ms, approval, performance, data)
      VALUES (${l.assetId}, ${l.specification.id}, ${l.provider}, ${l.modelVersion}, ${l.cost},
              ${l.latencyMs}, ${l.approval}, ${l.performance}, ${JSON.stringify(l)}::jsonb)
      ON CONFLICT (asset_id) DO UPDATE SET data = EXCLUDED.data, provider = EXCLUDED.provider,
        model_version = EXCLUDED.model_version, cost = EXCLUDED.cost, latency_ms = EXCLUDED.latency_ms,
        approval = EXCLUDED.approval, performance = EXCLUDED.performance`;
    return l;
  }
  async get(assetId: string) {
    await ensureLineageTable(this.sql);
    const rows = (await this.sql`SELECT data FROM ci_asset_lineage WHERE asset_id = ${assetId}`) as { data: AssetLineage }[];
    return rows[0]?.data ?? null;
  }
}
