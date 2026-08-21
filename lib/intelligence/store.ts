import { randomUUID } from "node:crypto";
import { db, RUNTIME_DDL, type Sql } from "@/lib/db";
import { selectReferences } from "./retrieve";
import { SEED } from "./seed";
import { assertCitable, type NewReference, type Reference, type ReferenceQuery } from "./types";

// Where the intelligence corpus lives. Same repository shape as every other store here:
// one interface, in-memory for tests and unconfigured environments, Neon for production.

export interface ReferenceRepo {
  add(r: NewReference): Promise<Reference>;
  /** Bulk ingest. Returns how many were written and why the rest were not. */
  addMany(rows: NewReference[]): Promise<{ added: number; rejected: { pattern: string; reason: string }[] }>;
  find(q: ReferenceQuery): Promise<Reference[]>;
  /** Everything visible to one workspace, for the library page. */
  browse(workspaceKey: string, limit?: number): Promise<Reference[]>;
  count(workspaceKey: string): Promise<{ total: number; shared: number; own: number }>;
}

function materialise(r: NewReference): Reference {
  assertCitable(r);
  return { ...r, id: randomUUID(), createdAt: Date.now() };
}

export class InMemoryReferenceRepo implements ReferenceRepo {
  private rows: Reference[] = [];
  constructor(seed: NewReference[] = []) {
    for (const s of seed) this.rows.push(materialise(s));
  }
  async add(r: NewReference) {
    const row = materialise(r);
    this.rows.push(row);
    return row;
  }
  async addMany(rows: NewReference[]) {
    const rejected: { pattern: string; reason: string }[] = [];
    let added = 0;
    for (const r of rows) {
      try { await this.add(r); added++; }
      catch (e) { rejected.push({ pattern: r.pattern.slice(0, 80), reason: String(e instanceof Error ? e.message : e) }); }
    }
    return { added, rejected };
  }
  async find(q: ReferenceQuery) { return selectReferences(this.rows, q); }
  async browse(workspaceKey: string, limit = 200) {
    return this.rows
      .filter((r) => r.workspaceKey === null || r.workspaceKey === workspaceKey)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  async count(workspaceKey: string) {
    const visible = this.rows.filter((r) => r.workspaceKey === null || r.workspaceKey === workspaceKey);
    const own = visible.filter((r) => r.workspaceKey === workspaceKey).length;
    return { total: visible.length, shared: visible.length - own, own };
  }
}

let ready = false;
async function ensure(sql: Sql) {
  if (ready || !RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS intel_references (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL,
    workspace_key TEXT,
    pattern TEXT NOT NULL,
    evidence TEXT NOT NULL,
    excerpt TEXT,
    metrics JSONB NOT NULL DEFAULT '[]'::jsonb,
    source JSONB NOT NULL,
    channel TEXT,
    industry TEXT,
    audience TEXT,
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // Retrieval always filters on visibility first: the shared library plus one workspace.
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_ref_ws ON intel_references (workspace_key, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_intel_ref_channel ON intel_references (channel, kind)`;

  // Seed the shared library once.
  //
  // The in-memory repo took SEED in its constructor and the Neon one did not, so the corpus
  // was populated in tests and empty everywhere a customer would look. A seed that only
  // exists in the environment without a database is not a seed.
  //
  // Guarded on the shared library being empty rather than on a row count or a version, so
  // this is idempotent across restarts and across concurrent boots: the second one inserts
  // nothing. Rows anyone has since added are what makes it non-empty, so this never runs
  // again and never duplicates.
  const [{ n }] = (await sql`
    SELECT COUNT(*)::int AS n FROM intel_references WHERE workspace_key IS NULL`) as { n: number }[];
  if (n === 0) {
    for (const r of SEED) {
      await sql`
        INSERT INTO intel_references (kind, workspace_key, pattern, evidence, excerpt, metrics, source, channel, industry, audience, tags)
        VALUES (${r.kind}, ${null}, ${r.pattern}, ${r.evidence}, ${r.excerpt},
                ${JSON.stringify(r.metrics)}::jsonb, ${JSON.stringify(r.source)}::jsonb,
                ${r.channel}, ${r.industry}, ${r.audience}, ${r.tags})`;
    }
    console.info(JSON.stringify({ event: "intel_seeded", rows: SEED.length }));
  }
  ready = true;
}

type Row = {
  id: string; kind: string; workspace_key: string | null; pattern: string; evidence: string;
  excerpt: string | null; metrics: Reference["metrics"]; source: Reference["source"];
  channel: string | null; industry: string | null; audience: string | null;
  tags: string[]; created_at: string;
};

const toReference = (r: Row): Reference => ({
  id: r.id,
  kind: r.kind as Reference["kind"],
  workspaceKey: r.workspace_key,
  pattern: r.pattern,
  evidence: r.evidence,
  excerpt: r.excerpt,
  metrics: r.metrics ?? [],
  source: r.source,
  channel: r.channel as Reference["channel"],
  industry: r.industry,
  audience: r.audience,
  tags: r.tags ?? [],
  createdAt: new Date(r.created_at).getTime(),
});

export class NeonReferenceRepo implements ReferenceRepo {
  constructor(private sql: Sql) {}

  async add(r: NewReference) {
    assertCitable(r);
    await ensure(this.sql);
    const rows = (await this.sql`
      INSERT INTO intel_references (kind, workspace_key, pattern, evidence, excerpt, metrics, source, channel, industry, audience, tags)
      VALUES (${r.kind}, ${r.workspaceKey}, ${r.pattern}, ${r.evidence}, ${r.excerpt},
              ${JSON.stringify(r.metrics)}::jsonb, ${JSON.stringify(r.source)}::jsonb,
              ${r.channel}, ${r.industry}, ${r.audience}, ${r.tags})
      RETURNING *`) as Row[];
    return toReference(rows[0]);
  }

  async addMany(rows: NewReference[]) {
    const rejected: { pattern: string; reason: string }[] = [];
    let added = 0;
    for (const r of rows) {
      try { await this.add(r); added++; }
      catch (e) { rejected.push({ pattern: r.pattern.slice(0, 80), reason: String(e instanceof Error ? e.message : e) }); }
    }
    return { added, rejected };
  }

  /**
   * Candidates are narrowed in SQL and ranked in memory.
   *
   * The ranking is facet overlap over a few hundred rows — cheap, and identical to the
   * in-memory repo's, so a scan cannot rank differently from a query. Pushing the scoring
   * into SQL would give two implementations of the one thing every generation depends on.
   */
  async find(q: ReferenceQuery) {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT * FROM intel_references
      WHERE (workspace_key IS NULL OR workspace_key = ${q.workspaceKey})
        AND (${q.channel ?? null}::text IS NULL OR channel IS NULL OR channel = ${q.channel ?? null})
      ORDER BY created_at DESC LIMIT 500`) as Row[];
    return selectReferences(rows.map(toReference), q);
  }

  async browse(workspaceKey: string, limit = 200) {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT * FROM intel_references
      WHERE workspace_key IS NULL OR workspace_key = ${workspaceKey}
      ORDER BY created_at DESC LIMIT ${limit}`) as Row[];
    return rows.map(toReference);
  }

  async count(workspaceKey: string) {
    await ensure(this.sql);
    const rows = (await this.sql`
      SELECT
        COUNT(*) FILTER (WHERE workspace_key IS NULL) AS shared,
        COUNT(*) FILTER (WHERE workspace_key = ${workspaceKey}) AS own
      FROM intel_references
      WHERE workspace_key IS NULL OR workspace_key = ${workspaceKey}`) as { shared: string; own: string }[];
    const shared = Number(rows[0]?.shared ?? 0);
    const own = Number(rows[0]?.own ?? 0);
    return { total: shared + own, shared, own };
  }
}

let memo: ReferenceRepo | null = null;
export function referenceRepo(): ReferenceRepo {
  if (memo) return memo;
  const sql = db();
  memo = sql ? new NeonReferenceRepo(sql) : new InMemoryReferenceRepo(SEED);
  return memo;
}

export function resetReferenceRepoForTests(): void {
  memo = null;
}

// Re-exported so callers get the seed and the store from one place.
export { SEED };
