import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type { AdvancedSettings, AssistantSettings } from "./types";
import { ADVANCED_DEFAULTS } from "./types";

// Where the four answers live. Same repository shape as the rest of the app: an in-memory
// store for tests and local runs, a Neon-backed one when a database is configured, chosen
// in shared.ts. Nothing else in the assistant knows which is in use.

export type StoredAssistant = AssistantSettings & { advanced: AdvancedSettings };

export interface AssistantStore {
  get(tenant: string): Promise<StoredAssistant | null>;
  save(s: StoredAssistant): Promise<void>;
  remove(tenant: string): Promise<void>;
}

export class InMemoryAssistantStore implements AssistantStore {
  private map = new Map<string, StoredAssistant>();
  async get(tenant: string) { return this.map.get(tenant) ?? null; }
  async save(s: StoredAssistant) { this.map.set(s.tenant, s); }
  async remove(tenant: string) { this.map.delete(tenant); }
}

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS assistant_settings (
    tenant TEXT PRIMARY KEY,
    settings JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  ready = true;
}

export class NeonAssistantStore implements AssistantStore {
  constructor(private sql: Sql) {}

  async get(tenant: string) {
    await ensureTable(this.sql);
    const rows = (await this.sql`SELECT settings FROM assistant_settings WHERE tenant = ${tenant}`) as Record<string, unknown>[];
    if (!rows[0]) return null;
    const s = rows[0].settings as StoredAssistant;
    // Advanced settings gained fields over time; fill any the stored row predates so an
    // older row never reads back as a missing value.
    return { ...s, advanced: { ...ADVANCED_DEFAULTS, ...(s.advanced ?? {}) } };
  }

  async save(s: StoredAssistant) {
    await ensureTable(this.sql);
    await this.sql`INSERT INTO assistant_settings (tenant, settings)
      VALUES (${s.tenant}, ${JSON.stringify(s)}::jsonb)
      ON CONFLICT (tenant) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()`;
  }

  async remove(tenant: string) {
    await ensureTable(this.sql);
    await this.sql`DELETE FROM assistant_settings WHERE tenant = ${tenant}`;
  }
}
