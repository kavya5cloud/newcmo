import { type Sql, RUNTIME_DDL } from "@/lib/db";
import { ASSET_KIND_META, type AssetKind } from "@/lib/creative/taxonomy";
import type { AssetAggregate, Pattern, PatternKind } from "./types";
import { blend, clamp01, idFrom, round } from "./util";

// Pattern Library (Part 3) — deterministic extraction of what WON from aggregated
// performance. Each pattern is versioned and stores confidence/performance/industry/
// audience/campaign/platform/history. Searchable. No LLM.

// Which pattern kind a winning asset contributes to (by asset kind).
const PATTERN_FOR_KIND: Partial<Record<AssetKind, PatternKind>> = {
  hero_video: "winning_video_structure", product_demo: "winning_video_structure",
  ugc_video: "winning_ugc_style", motion_graphic: "winning_motion",
  landing_hero: "winning_layout", carousel: "winning_layout", infographic: "winning_image_style",
  instagram_post: "winning_image_style", advertisement: "winning_headline",
  blog: "winning_headline", press_release: "winning_headline",
  linkedin_post: "winning_hook", x_thread: "winning_hook", reddit_post: "winning_hook",
  email: "winning_cta", sales_deck: "winning_story", case_study: "winning_story",
};

const WIN_THRESHOLD = 0.35; // aggregate score at/above which an asset counts as "winning"

/**
 * Rows written before patterns had an owner.
 *
 * They were extracted from whichever workspaces happened to ingest first and cannot now be
 * attributed to any of them, so they are never returned to anyone. Deleting them would be
 * defensible too; keeping them inert costs nothing and loses no evidence.
 */
export const UNATTRIBUTED = "__unattributed__";

/** Extract patterns from aggregated performance. Deterministic; sorted best-first. */
export function extractPatterns(
  aggregates: AssetAggregate[],
  opts: { minScore?: number; workspaceKey?: string } = {},
): Pattern[] {
  const min = opts.minScore ?? WIN_THRESHOLD;
  const ws = opts.workspaceKey ?? UNATTRIBUTED;
  const patterns: Pattern[] = [];

  for (const a of aggregates) {
    if (a.score < min) continue;
    const kind = a.kind ? PATTERN_FOR_KIND[a.kind] : undefined;
    if (kind) {
      patterns.push(makePattern(kind, a.kind ? ASSET_KIND_META[a.kind].label : a.assetKey, a.assetKey, a, ws));
    }
    // Posting-time pattern when a best hour is known.
    if (a.bestHour !== null) {
      patterns.push(makePattern("winning_posting_time", `${a.platform} best hour`, `hour_${a.bestHour}`, a, ws));
    }
  }
  return patterns.sort((x, y) => y.performance - x.performance || x.id.localeCompare(y.id));
}

function makePattern(kind: PatternKind, label: string, value: string, a: AssetAggregate, workspaceKey: string): Pattern {
  return {
    // workspaceKey leads the id. Two businesses posting an asset with the same key are two
    // different facts, and merging them produces a performance number that describes
    // neither of them.
    id: idFrom("pat", workspaceKey, kind, value, a.platform, a.audience ?? "", a.campaignId ?? ""),
    workspaceKey,
    kind, label, value,
    performance: a.score,
    confidence: clamp01(a.score * 0.6 + Math.min(1, a.eventCount / 5) * 0.4),
    industry: a.industry ?? null, audience: a.audience ?? null,
    campaign: a.campaignId ?? null, platform: a.platform,
    version: 1, history: [{ at: 0, performance: a.score }],
  };
}

export type PatternQuery = { kind?: PatternKind; platform?: string; audience?: string; industry?: string };

export function searchPatterns(patterns: Pattern[], q: PatternQuery = {}, limit = 20): Pattern[] {
  return patterns
    .filter((p) => (!q.kind || p.kind === q.kind) && (!q.platform || p.platform === q.platform)
      && (!q.audience || p.audience === q.audience) && (!q.industry || p.industry === q.industry))
    .sort((a, b) => b.performance - a.performance || a.id.localeCompare(b.id))
    .slice(0, limit);
}

// ---- Repository (in-memory + Neon); records are versioned, never overwritten ----

export interface PatternStore {
  record(p: Pattern): Promise<Pattern>;
  /** Scoped to one workspace. There is no unscoped read — that was the bug. */
  search(workspaceKey: string, q?: PatternQuery, limit?: number): Promise<Pattern[]>;
  all(workspaceKey: string): Promise<Pattern[]>;
}

export class InMemoryPatternStore implements PatternStore {
  private map = new Map<string, Pattern>();
  async record(p: Pattern) {
    const prev = this.map.get(p.id);
    const next: Pattern = prev
      ? { ...prev, performance: round(blend(prev.performance, p.performance, prev.version)), confidence: round(blend(prev.confidence, p.confidence, prev.version)), version: prev.version + 1, history: [...prev.history, { at: p.history[0]?.at ?? 0, performance: p.performance }] }
      : p;
    this.map.set(p.id, next);
    return next;
  }
  async search(workspaceKey: string, q: PatternQuery = {}, limit = 20) {
    return searchPatterns([...this.map.values()].filter((p) => p.workspaceKey === workspaceKey), q, limit);
  }
  async all(workspaceKey: string) {
    return [...this.map.values()].filter((p) => p.workspaceKey === workspaceKey);
  }
}

let patReady = false;
async function ensurePatternTable(sql: Sql) {
  if (patReady) return;
  if (!RUNTIME_DDL) { patReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS learn_patterns (
    id TEXT PRIMARY KEY,
    workspace_key TEXT NOT NULL DEFAULT ${UNATTRIBUTED},
    kind TEXT NOT NULL,
    performance REAL NOT NULL DEFAULT 0,
    confidence REAL NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 1,
    platform TEXT, audience TEXT, industry TEXT,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // Existing deployments have the table without the column. Added separately so an upgrade
  // does not depend on the CREATE running, and defaulted to the sentinel so rows written
  // before ownership existed stay unreadable rather than being handed to whoever asks next.
  await sql`ALTER TABLE learn_patterns ADD COLUMN IF NOT EXISTS workspace_key TEXT NOT NULL DEFAULT ${UNATTRIBUTED}`;
  await sql`CREATE INDEX IF NOT EXISTS idx_learn_pat_kind ON learn_patterns (kind, performance DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_learn_pat_ws ON learn_patterns (workspace_key, performance DESC)`;
  patReady = true;
}

export class NeonPatternStore implements PatternStore {
  constructor(private sql: Sql) {}
  async record(p: Pattern) {
    await ensurePatternTable(this.sql);
    const rows = (await this.sql`
      INSERT INTO learn_patterns (id, workspace_key, kind, performance, confidence, version, platform, audience, industry, data)
      VALUES (${p.id}, ${p.workspaceKey}, ${p.kind}, ${p.performance}, ${p.confidence}, ${p.version}, ${p.platform}, ${p.audience}, ${p.industry}, ${JSON.stringify(p)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        version = learn_patterns.version + 1,
        performance = (learn_patterns.performance * learn_patterns.version + EXCLUDED.performance) / (learn_patterns.version + 1),
        confidence = (learn_patterns.confidence * learn_patterns.version + EXCLUDED.confidence) / (learn_patterns.version + 1),
        data = EXCLUDED.data, updated_at = now()
      RETURNING data`) as { data: Pattern }[];
    return rows[0]?.data ?? p;
  }
  async search(workspaceKey: string, q: PatternQuery = {}, limit = 20) {
    await ensurePatternTable(this.sql);
    const rows = (await this.sql`
      SELECT data FROM learn_patterns WHERE workspace_key = ${workspaceKey}
      ORDER BY performance DESC LIMIT 500`) as { data: Pattern }[];
    return searchPatterns(rows.map((r) => r.data), q, limit);
  }
  async all(workspaceKey: string) {
    await ensurePatternTable(this.sql);
    const rows = (await this.sql`
      SELECT data FROM learn_patterns WHERE workspace_key = ${workspaceKey}
      ORDER BY performance DESC LIMIT 500`) as { data: Pattern }[];
    return rows.map((r) => r.data);
  }
}
