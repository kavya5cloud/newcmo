import type { Sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

/**
 * Populr intelligence layer — the recommendation → action → outcome dataset.
 *
 * Everything here is EVENT-SOURCED and APPEND-ONLY:
 *   - recommendations        every recommendation ever generated (never updated)
 *   - recommendation_events  every state transition (generated/viewed/drafted/approved/…)
 *   - content_assets         every produced deliverable body
 *   - business_profiles      versioned snapshots of the analyzed company profile
 *   - outcome_snapshots      periodic GSC metric captures (never overwritten)
 *   - recommendation_scores  computed before/after deltas + association scores
 *   - websites               registry of analyzed sites per workspace (upsert — registry, not history)
 *   - marketing_channels     static channel catalog (seeded once)
 *   - approval_history       SQL view over recommendation_events (approval/dismissal/publication)
 *
 * We deliberately do NOT claim causality anywhere: scores are *association* scores —
 * "this action was followed by this measured change" — with a confidence derived from
 * data volume. Model training happens later, on top of this dataset; nothing trains now.
 */

// Bump when the recommendation prompt/shape changes so rows are comparable within a version.
export const PROMPT_VERSION = process.env.PROMPT_VERSION || "p1";

export const REC_EVENTS = [
  "generated",
  "viewed",
  "edited",
  "drafted",
  "approved",
  "dismissed",
  "scheduled",
  "published",
  "completed",
  "expired",
] as const;
export type RecEvent = (typeof REC_EVENTS)[number];

export const CHANNELS: Record<string, string> = {
  reddit: "Reddit",
  seo: "SEO",
  geo: "AI search (GEO)",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  articles: "Articles",
  hn: "Hacker News",
};

/** Storage key: server-derived user id when signed in (unspoofable), else anonymous wsid. */
export async function workspaceKey(clientWsid: string | null | undefined): Promise<string | null> {
  const session = await getSession();
  if (session) return "user:" + session.userId;
  const wsid = (clientWsid || "").trim();
  if (!wsid || wsid.length > 100) return null;
  return "anon:" + wsid;
}

let intelReady = false;
export async function ensureIntelTables(sql: Sql) {
  if (intelReady) return;
  await sql`CREATE TABLE IF NOT EXISTS websites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    url TEXT NOT NULL,
    host TEXT NOT NULL,
    first_analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_analyzed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_key, host)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS marketing_channels (
    channel TEXT PRIMARY KEY,
    label TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS business_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    website TEXT NOT NULL,
    version INT NOT NULL,
    profile JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    website TEXT NOT NULL,
    host TEXT NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    rec_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    title TEXT NOT NULL,
    action_label TEXT,
    priority INT,
    confidence REAL,
    reasoning TEXT,
    expected_outcome TEXT,
    estimated_effort TEXT,
    estimated_impact TEXT,
    prompt_version TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    snapshot_version TEXT,
    business_profile_id UUID,
    client_key TEXT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_recs_ws ON recommendations (workspace_key, generated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_recs_host ON recommendations (host, generated_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS recommendation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id UUID NOT NULL REFERENCES recommendations(id),
    event TEXT NOT NULL,
    actor TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rec_events_rec ON recommendation_events (recommendation_id, created_at)`;
  await sql`CREATE TABLE IF NOT EXISTS content_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id UUID REFERENCES recommendations(id),
    workspace_key TEXT NOT NULL,
    channel TEXT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS outcome_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_key TEXT NOT NULL,
    site_url TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'gsc',
    period_days INT NOT NULL,
    metrics JSONB NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_snapshots_ws ON outcome_snapshots (workspace_key, site_url, captured_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS recommendation_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recommendation_id UUID NOT NULL REFERENCES recommendations(id),
    before_snapshot_id UUID REFERENCES outcome_snapshots(id),
    after_snapshot_id UUID REFERENCES outcome_snapshots(id),
    delta JSONB NOT NULL,
    association_score REAL NOT NULL,
    expected_roi REAL,
    confidence REAL NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (recommendation_id, before_snapshot_id, after_snapshot_id)
  )`;
  await sql`CREATE OR REPLACE VIEW approval_history AS
    SELECT e.id, e.recommendation_id, r.workspace_key, r.channel, r.title,
           e.event, e.actor, e.created_at
    FROM recommendation_events e
    JOIN recommendations r ON r.id = e.recommendation_id
    WHERE e.event IN ('approved', 'dismissed', 'published')`;
  // Seed the channel catalog (idempotent).
  for (const [channel, label] of Object.entries(CHANNELS)) {
    await sql`INSERT INTO marketing_channels (channel, label) VALUES (${channel}, ${label})
              ON CONFLICT (channel) DO NOTHING`;
  }
  intelReady = true;
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u.slice(0, 100);
  }
}

export type RecInput = {
  channel: string;
  title: string;
  actionLabel?: string;
  recType?: string;
  priority?: number;
  reasoning?: string;
  expectedOutcome?: string;
  clientKey?: string;
};

/**
 * Append a batch of freshly generated recommendations plus their versioned business
 * profile, register the website, and log a 'generated' event for each.
 * Returns clientKey → recommendation UUID so the client can report later transitions.
 */
export async function logRecommendations(
  sql: Sql,
  wsKey: string,
  website: string,
  profile: unknown,
  items: RecInput[],
  meta: { provider?: string | null; model?: string | null; snapshotVersion?: string | null }
): Promise<Record<string, string>> {
  await ensureIntelTables(sql);
  const host = hostOf(website);

  await sql`
    INSERT INTO websites (workspace_key, url, host)
    VALUES (${wsKey}, ${website}, ${host})
    ON CONFLICT (workspace_key, host) DO UPDATE SET last_analyzed_at = now(), url = EXCLUDED.url`;

  const verRows = (await sql`
    SELECT COALESCE(MAX(version), 0) + 1 AS v FROM business_profiles
    WHERE workspace_key = ${wsKey} AND website = ${website}`) as { v: number }[];
  const version = Number(verRows[0]?.v || 1);
  const profRows = (await sql`
    INSERT INTO business_profiles (workspace_key, website, version, profile)
    VALUES (${wsKey}, ${website}, ${version}, ${JSON.stringify(profile ?? {})})
    RETURNING id`) as { id: string }[];
  const profileId = profRows[0]?.id ?? null;

  const ids: Record<string, string> = {};
  for (const it of items) {
    const rows = (await sql`
      INSERT INTO recommendations
        (workspace_key, website, host, rec_type, channel, title, action_label, priority,
         reasoning, expected_outcome, prompt_version, provider, model, snapshot_version,
         business_profile_id, client_key)
      VALUES
        (${wsKey}, ${website}, ${host}, ${it.recType || "feed_item"}, ${it.channel},
         ${it.title.slice(0, 500)}, ${it.actionLabel || null}, ${it.priority ?? null},
         ${it.reasoning || null}, ${it.expectedOutcome || null}, ${PROMPT_VERSION},
         ${meta.provider || null}, ${meta.model || null}, ${meta.snapshotVersion || null},
         ${profileId}, ${it.clientKey || null})
      RETURNING id`) as { id: string }[];
    const id = rows[0]?.id;
    if (id) {
      await sql`INSERT INTO recommendation_events (recommendation_id, event, actor, metadata)
                VALUES (${id}, 'generated', 'system', '{}'::jsonb)`;
      if (it.clientKey) ids[it.clientKey] = id;
    }
  }
  return ids;
}

/** Append one lifecycle event. The recommendation must belong to this workspace. */
export async function logRecEvent(
  sql: Sql,
  wsKey: string,
  recommendationId: string,
  event: RecEvent,
  actor: string,
  metadata: Record<string, unknown> = {}
): Promise<boolean> {
  await ensureIntelTables(sql);
  const owns = (await sql`
    SELECT 1 FROM recommendations WHERE id = ${recommendationId} AND workspace_key = ${wsKey}`) as unknown[];
  if (!owns.length) return false;
  await sql`INSERT INTO recommendation_events (recommendation_id, event, actor, metadata)
            VALUES (${recommendationId}, ${event}, ${actor.slice(0, 200)}, ${JSON.stringify(metadata)})`;
  return true;
}

export async function logContentAsset(
  sql: Sql,
  wsKey: string,
  recommendationId: string | null,
  channel: string | null,
  title: string,
  body: string
): Promise<void> {
  await ensureIntelTables(sql);
  await sql`INSERT INTO content_assets (recommendation_id, workspace_key, channel, title, body)
            VALUES (${recommendationId}, ${wsKey}, ${channel}, ${title.slice(0, 500)}, ${body.slice(0, 50_000)})`;
}

export {
  computeDelta,
  associationScore,
  scoreConfidence,
  type SnapshotMetrics,
  type MetricDelta,
} from "@/lib/intel-score";
import type { SnapshotMetrics } from "@/lib/intel-score";

export async function saveOutcomeSnapshot(
  sql: Sql,
  wsKey: string,
  siteUrl: string,
  periodDays: number,
  metrics: SnapshotMetrics
): Promise<string | null> {
  await ensureIntelTables(sql);
  const rows = (await sql`
    INSERT INTO outcome_snapshots (workspace_key, site_url, period_days, metrics)
    VALUES (${wsKey}, ${siteUrl}, ${periodDays}, ${JSON.stringify(metrics)})
    RETURNING id`) as { id: string }[];
  return rows[0]?.id ?? null;
}

// Pure scoring math lives in lib/intel-score.ts (framework-free, unit-tested) and is
// re-exported above so server code can import everything from "@/lib/intel".
