import { type Sql, RUNTIME_DDL } from "@/lib/db";
import type { Character, Persona } from "./types";
import { idFrom, pick } from "./util";

// Character Engine — reusable AI presenters / UGC personas. Characters are first-class
// reusable assets (they belong in the Asset Graph via workspaceKey + id) so UGC and
// AI-presenter output stays visually and vocally consistent across a launch.

const VOICES = ["warm and grounded", "energetic and fast", "calm and authoritative", "friendly and casual"] as const;
const MOVEMENTS = ["relaxed, natural gestures", "expressive, high-energy", "minimal, composed", "conversational lean-ins"] as const;

/** Build a deterministic Character from a persona + brand voice. */
export function buildCharacter(input: {
  name: string;
  persona: Persona;
  brandVoice: string;
  appearance?: string;
  style?: string;
  workspaceKey?: string;
}): Character {
  const seed = `${input.name}|${input.persona.audience}|${input.brandVoice}`;
  return {
    id: idFrom("char", input.name, input.persona.audience, input.workspaceKey ?? ""),
    name: input.name,
    identity: `${input.name} — a ${input.persona.audience} who values ${input.persona.motivations[0] ?? "results"}.`,
    appearance: input.appearance || "approachable, real, not overly polished",
    voice: pick(VOICES, seed),
    expressions: ["confident smile", "focused", "genuine surprise", "reassuring nod"],
    brand: `Embodies the brand voice: ${input.brandVoice}.`,
    style: input.style || "modern, relatable, on-brand",
    referenceImages: [],
    movementStyle: pick(MOVEMENTS, seed + "move"),
    workspaceKey: input.workspaceKey,
    version: 1,
  };
}

// ---- Repository pattern: in-memory (default/tests) + Neon-backed (prod) ----

export interface CharacterStore {
  create(c: Character): Promise<Character>;
  get(id: string): Promise<Character | null>;
  list(workspaceKey?: string): Promise<Character[]>;
}

export class InMemoryCharacterStore implements CharacterStore {
  private map = new Map<string, Character>();
  async create(c: Character) { this.map.set(c.id, c); return c; }
  async get(id: string) { return this.map.get(id) ?? null; }
  async list(workspaceKey?: string) {
    const all = [...this.map.values()];
    return workspaceKey ? all.filter((c) => c.workspaceKey === workspaceKey) : all;
  }
}

let charReady = false;
async function ensureCharacterTable(sql: Sql) {
  if (charReady) return;
  if (!RUNTIME_DDL) { charReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS ci_characters (
    id TEXT PRIMARY KEY,
    workspace_key TEXT,
    name TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ci_char_ws ON ci_characters (workspace_key, created_at DESC)`;
  charReady = true;
}

export class NeonCharacterStore implements CharacterStore {
  constructor(private sql: Sql) {}
  async create(c: Character) {
    await ensureCharacterTable(this.sql);
    await this.sql`INSERT INTO ci_characters (id, workspace_key, name, version, data)
      VALUES (${c.id}, ${c.workspaceKey ?? null}, ${c.name}, ${c.version}, ${JSON.stringify(c)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, version = ci_characters.version + 1`;
    return c;
  }
  async get(id: string) {
    await ensureCharacterTable(this.sql);
    const rows = (await this.sql`SELECT data FROM ci_characters WHERE id = ${id}`) as { data: Character }[];
    return rows[0]?.data ?? null;
  }
  async list(workspaceKey?: string) {
    await ensureCharacterTable(this.sql);
    const rows = workspaceKey
      ? (await this.sql`SELECT data FROM ci_characters WHERE workspace_key = ${workspaceKey} ORDER BY created_at DESC LIMIT 200`) as { data: Character }[]
      : (await this.sql`SELECT data FROM ci_characters ORDER BY created_at DESC LIMIT 200`) as { data: Character }[];
    return rows.map((r) => r.data);
  }
}
