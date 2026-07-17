import type { Sql } from "@/lib/db";
import type { AssetInput, AssetEvent } from "@/lib/services/asset-validate";

// Content Studio service — the Asset Graph.
//
// Every asset is an OBJECT in a derivation tree: a root asset (e.g. the blog) is
// generated from the campaign's creative brief, and children (LinkedIn post, X thread,
// Reddit post, email) are derived FROM the root, keeping the ecosystem consistent.
//
// Versioning works like git history:
//   - every edit/regeneration INSERTS a new content_assets row (never updates body)
//   - rows in one chain share root_id; version increments; v1's root_id = its own id
//   - parent_asset_id edges always point at the parent chain's root_id (stable)
//   - asset_events is the append-only lifecycle log (generated → edited → approved →
//     scheduled → published → measured → archived)
//   - status is the chain's CURRENT state (registry column, mirrored on all rows of
//     the chain); history lives in asset_events

let assetTablesReady = false;
export async function ensureAssetTables(sql: Sql) {
  if (assetTablesReady) return;
  // content_assets exists (intelligence layer) — extend it into the graph model.
  await sql`ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS campaign_id UUID`;
  await sql`ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS asset_type TEXT`;
  await sql`ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS purpose TEXT`;
  await sql`ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'`;
  await sql`ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS parent_asset_id UUID`;
  await sql`ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS root_id UUID`;
  await sql`ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1`;
  await sql`ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS structure JSONB`;
  await sql`CREATE INDEX IF NOT EXISTS idx_assets_campaign ON content_assets (campaign_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_assets_root ON content_assets (root_id, version)`;
  await sql`CREATE TABLE IF NOT EXISTS asset_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES content_assets(id),
    event TEXT NOT NULL,
    actor TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_asset_events ON asset_events (asset_id, created_at)`;
  assetTablesReady = true;
}

/** Insert a validated asset graph for a campaign. Returns clientKey → root_id. */
export async function createAssetGraph(
  sql: Sql,
  wsKey: string,
  campaignId: string,
  assets: AssetInput[],
  actor: string
): Promise<Record<string, string>> {
  await ensureAssetTables(sql);

  const ids: Record<string, string> = {};
  // Parents before children so parent_asset_id can resolve within one pass.
  const ordered = [...assets].sort((a, b) => Number(a.parentKey !== null) - Number(b.parentKey !== null));
  for (const a of ordered) {
    const parentRootId = a.parentKey ? ids[a.parentKey] ?? null : null;
    const rows = (await sql`
      INSERT INTO content_assets
        (workspace_key, campaign_id, channel, title, body, asset_type, purpose,
         parent_asset_id, structure, status, version)
      VALUES
        (${wsKey}, ${campaignId}, ${a.channel}, ${a.title}, ${a.body}, ${a.assetType},
         ${a.purpose}, ${parentRootId}, ${a.structure ? JSON.stringify(a.structure) : null},
         'draft', 1)
      RETURNING id`) as { id: string }[];
    const id = rows[0].id;
    await sql`UPDATE content_assets SET root_id = ${id} WHERE id = ${id}`;
    await sql`INSERT INTO asset_events (asset_id, event, actor, metadata)
              VALUES (${id}, 'generated', ${actor}, ${JSON.stringify({ derivedFrom: parentRootId })})`;
    ids[a.clientKey] = id;
  }
  return ids;
}

export type AssetRow = {
  id: string;
  root_id: string;
  version: number;
  campaign_id: string;
  channel: string;
  asset_type: string;
  purpose: string | null;
  title: string;
  body: string;
  structure: Record<string, unknown> | null;
  status: string;
  parent_asset_id: string | null;
  created_at: string;
};

/** All versions of all assets for a campaign (client groups by root_id). */
export async function listAssets(sql: Sql, wsKey: string, campaignId: string): Promise<AssetRow[]> {
  await ensureAssetTables(sql);
  return (await sql`
    SELECT id, root_id, version, campaign_id, channel, asset_type, purpose, title, body,
           structure, status, parent_asset_id, created_at
    FROM content_assets
    WHERE workspace_key = ${wsKey} AND campaign_id = ${campaignId}
    ORDER BY created_at`) as AssetRow[];
}

const STATUS_FOR_EVENT: Partial<Record<AssetEvent, string>> = {
  approved: "approved",
  rejected: "rejected",
  scheduled: "scheduled",
  published: "published",
  archived: "archived",
};

/**
 * Append a lifecycle event to an asset chain (ownership-checked).
 * 'edited'/'regenerated' with a body create a NEW VERSION row in the chain and the
 * event attaches to that new row — history is never overwritten.
 * Returns the id of the row the event landed on, or null if not found.
 */
export async function logAssetEvent(
  sql: Sql,
  wsKey: string,
  assetId: string,
  event: AssetEvent,
  actor: string,
  opts: { body?: string; title?: string; structure?: Record<string, unknown>; metadata?: Record<string, unknown> } = {}
): Promise<{ id: string; version: number } | null> {
  await ensureAssetTables(sql);
  const rows = (await sql`
    SELECT id, root_id FROM content_assets
    WHERE id = ${assetId} AND workspace_key = ${wsKey}`) as { id: string; root_id: string }[];
  if (!rows.length) return null;
  const rootId = rows[0].root_id;

  let targetId = assetId;
  let version = 0;

  if ((event === "edited" || event === "regenerated") && opts.body) {
    const latest = (await sql`
      SELECT id, version, campaign_id, channel, asset_type, purpose, parent_asset_id, title, structure
      FROM content_assets WHERE root_id = ${rootId}
      ORDER BY version DESC LIMIT 1`) as {
      id: string; version: number; campaign_id: string; channel: string; asset_type: string;
      purpose: string | null; parent_asset_id: string | null; title: string; structure: unknown;
    }[];
    const l = latest[0];
    version = l.version + 1;
    const inserted = (await sql`
      INSERT INTO content_assets
        (workspace_key, campaign_id, channel, title, body, asset_type, purpose,
         parent_asset_id, root_id, structure, status, version)
      VALUES
        (${wsKey}, ${l.campaign_id}, ${l.channel}, ${opts.title || l.title}, ${opts.body},
         ${l.asset_type}, ${l.purpose}, ${l.parent_asset_id}, ${rootId},
         ${opts.structure ? JSON.stringify(opts.structure) : (l.structure ? JSON.stringify(l.structure) : null)},
         'draft', ${version})
      RETURNING id`) as { id: string }[];
    targetId = inserted[0].id;
  }

  await sql`INSERT INTO asset_events (asset_id, event, actor, metadata)
            VALUES (${targetId}, ${event}, ${actor.slice(0, 200)}, ${JSON.stringify(opts.metadata ?? {})})`;

  const status = STATUS_FOR_EVENT[event];
  if (status) {
    await sql`UPDATE content_assets SET status = ${status} WHERE root_id = ${rootId}`;
  } else if (event === "edited" || event === "regenerated") {
    await sql`UPDATE content_assets SET status = 'draft' WHERE root_id = ${rootId}`;
  }
  return { id: targetId, version };
}
