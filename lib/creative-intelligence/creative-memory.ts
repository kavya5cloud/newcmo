import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type { CreativeChannel } from "@/lib/creative/taxonomy";
import type { CreativeMemoryEntry, MemoryKind } from "./types";
import { clamp01, idFrom, words } from "./util";

// Creative Memory — the reusable, versioned store of what has WON: winning hooks, CTAs,
// story structures, colors, layouts, characters, video styles, motion patterns,
// headlines and openings. Searchable + versioned so the Spec Builder can reuse proven
// patterns. Complements lib/services/assets.getCreativeMemory (asset-level winners).

export function memoryEntry(
  kind: MemoryKind,
  label: string,
  value: string,
  performance: number,
  opts: { channels?: CreativeChannel[]; audiences?: string[]; tags?: string[] } = {},
): CreativeMemoryEntry {
  return {
    id: idFrom("mem", kind, label, value),
    kind, label, value,
    performance: clamp01(performance),
    channels: opts.channels ?? [],
    audiences: opts.audiences ?? [],
    tags: opts.tags ?? [],
    version: 1,
  };
}

// A small seed of proven patterns so retrieval is useful before any custom writes.
export const MEMORY_SEED: CreativeMemoryEntry[] = [
  memoryEntry("hook", "curiosity opener", "The {product} trick {audience} aren't talking about yet.", 0.82, { channels: ["x", "video"], tags: ["opener"] }),
  memoryEntry("cta", "low-friction CTA", "Join early access", 0.8, { channels: ["landing", "email"], tags: ["cta"] }),
  memoryEntry("story_structure", "problem-turn-outcome", "Setup(pain) → Turn(product) → Resolution(outcome) → CTA", 0.79, { tags: ["video"] }),
  memoryEntry("color", "brand green on near-black", "#d5ff72 on #0b0f0e", 0.77, { tags: ["palette"] }),
  memoryEntry("headline", "outcome-first headline", "Get 2x results without hiring a marketer", 0.81, { channels: ["landing", "ads"] }),
  memoryEntry("opening", "direct-address open", "Most founders drown in marketing busywork.", 0.75, { channels: ["video", "linkedin"] }),
];

export type MemoryQuery = { kind?: MemoryKind; channel?: CreativeChannel; text?: string; audience?: string };

function score(e: CreativeMemoryEntry, q: MemoryQuery): number {
  let s = e.performance;
  if (q.kind && e.kind === q.kind) s += 0.2;
  if (q.channel && e.channels.includes(q.channel)) s += 0.12;
  if (q.audience && e.audiences.some((a) => a.toLowerCase() === q.audience!.toLowerCase())) s += 0.06;
  if (q.text) {
    const qw = new Set(words(q.text));
    const ew = new Set([...words(e.label), ...words(e.value), ...e.tags]);
    let hit = 0; for (const w of qw) if (ew.has(w)) hit++;
    if (qw.size) s += 0.15 * (hit / qw.size);
  }
  return s;
}

/** Deterministic search over memory entries, best-first (ties break by id). */
export function searchMemory(entries: CreativeMemoryEntry[], q: MemoryQuery = {}, limit = 8): CreativeMemoryEntry[] {
  return [...entries]
    .filter((e) => !q.kind || e.kind === q.kind)
    .map((e) => ({ e, s: score(e, q) }))
    .sort((a, b) => b.s - a.s || a.e.id.localeCompare(b.e.id))
    .slice(0, limit)
    .map((x) => x.e);
}

// ---- Repository pattern ----

export interface CreativeMemoryStore {
  record(e: CreativeMemoryEntry): Promise<CreativeMemoryEntry>;
  search(q?: MemoryQuery, limit?: number): Promise<CreativeMemoryEntry[]>;
  list(): Promise<CreativeMemoryEntry[]>;
}

export class InMemoryCreativeMemoryStore implements CreativeMemoryStore {
  private map = new Map<string, CreativeMemoryEntry>();
  constructor(seed: CreativeMemoryEntry[] = MEMORY_SEED) { for (const e of seed) this.map.set(e.id, e); }
  async record(e: CreativeMemoryEntry) {
    const prev = this.map.get(e.id);
    const next = prev ? { ...e, version: prev.version + 1 } : e; // versioned on re-record
    this.map.set(e.id, next);
    return next;
  }
  async search(q: MemoryQuery = {}, limit = 8) { return searchMemory([...this.map.values()], q, limit); }
  async list() { return [...this.map.values()]; }
}

let memReady = false;
async function ensureMemoryTable(sql: Sql) {
  if (memReady) return;
  if (!RUNTIME_DDL) { memReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS ci_creative_memory (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    performance REAL NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ci_mem_kind ON ci_creative_memory (kind, performance DESC)`;
  memReady = true;
}

export class NeonCreativeMemoryStore implements CreativeMemoryStore {
  constructor(private sql: Sql) {}
  async record(e: CreativeMemoryEntry) {
    await ensureMemoryTable(this.sql);
    const rows = (await this.sql`
      INSERT INTO ci_creative_memory (id, kind, label, performance, version, data)
      VALUES (${e.id}, ${e.kind}, ${e.label}, ${e.performance}, ${e.version}, ${JSON.stringify(e)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        performance = EXCLUDED.performance,
        version = ci_creative_memory.version + 1,
        data = jsonb_set(EXCLUDED.data, '{version}', to_jsonb(ci_creative_memory.version + 1)),
        updated_at = now()
      RETURNING data`) as { data: CreativeMemoryEntry }[];
    return rows[0]?.data ?? e;
  }
  async search(q: MemoryQuery = {}, limit = 8) {
    await ensureMemoryTable(this.sql);
    const rows = (await this.sql`SELECT data FROM ci_creative_memory ORDER BY performance DESC LIMIT 500`) as { data: CreativeMemoryEntry }[];
    return searchMemory(rows.map((r) => r.data), q, limit);
  }
  async list() {
    await ensureMemoryTable(this.sql);
    const rows = (await this.sql`SELECT data FROM ci_creative_memory ORDER BY performance DESC LIMIT 500`) as { data: CreativeMemoryEntry }[];
    return rows.map((r) => r.data);
  }
}
