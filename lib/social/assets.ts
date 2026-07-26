import { type Sql, RUNTIME_DDL } from "@/lib/db";
import { CONSTRAINTS } from "./adapters";
import type { Asset, AssetKindMedia, SocialPlatform } from "./types";

// Asset Service — registers and validates the media attached to posts. It holds no
// platform logic of its own: per-platform rules come from the adapters' constraints, so
// adding a platform never means editing this file.

const MIME_KIND: Record<string, AssetKindMedia> = {
  "image/png": "image", "image/jpeg": "image", "image/webp": "image",
  "image/gif": "gif",
  "video/mp4": "video", "video/quicktime": "video", "video/webm": "video",
  "application/pdf": "document",
};

export type AssetInput = {
  uri: string;
  mime: string;
  altText?: string;
  width?: number;
  height?: number;
};

export type AssetValidation = { ok: boolean; errors: string[] };

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Build a validated Asset. Kind is derived from the MIME type, never trusted from input. */
export function createAsset(input: AssetInput): Asset {
  const kind = MIME_KIND[input.mime.toLowerCase()] ?? "document";
  return {
    id: `ast_${hash(input.uri + input.mime)}`,
    kind,
    uri: input.uri,
    mime: input.mime,
    altText: input.altText,
    width: input.width,
    height: input.height,
  };
}

/** Is this a MIME type we can attach at all? */
export function isSupportedMime(mime: string): boolean {
  return mime.toLowerCase() in MIME_KIND;
}

/**
 * Validate a set of assets against a platform's constraints (from its adapter).
 * Catches the mistakes that would otherwise fail at publish time.
 */
export function validateForPlatform(assets: Asset[], platform: SocialPlatform): AssetValidation {
  const c = CONSTRAINTS[platform];
  const errors: string[] = [];

  if (c.requiresAsset && assets.length === 0) errors.push(`${platform} requires at least one media asset`);
  if (assets.length > c.maxAssets) errors.push(`${platform} allows at most ${c.maxAssets} assets (got ${assets.length})`);
  if (!c.allowsVideo && assets.some((a) => a.kind === "video")) errors.push(`${platform} does not support video`);
  for (const a of assets) {
    if (!isSupportedMime(a.mime)) errors.push(`unsupported media type: ${a.mime}`);
    if (a.kind === "image" && !a.altText) errors.push(`image ${a.id} is missing alt text (accessibility)`);
  }
  return { ok: errors.length === 0, errors };
}

// ---- Store ----

export interface AssetStore {
  save(tenant: string, a: Asset): Promise<void>;
  get(id: string): Promise<Asset | null>;
  list(tenant: string): Promise<Asset[]>;
  remove(id: string): Promise<void>;
}

export class InMemoryAssetStore implements AssetStore {
  private m = new Map<string, { tenant: string; asset: Asset }>();
  async save(tenant: string, a: Asset) { this.m.set(a.id, { tenant, asset: a }); }
  async get(id: string) { return this.m.get(id)?.asset ?? null; }
  async list(tenant: string) { return [...this.m.values()].filter((x) => x.tenant === tenant).map((x) => x.asset); }
  async remove(id: string) { this.m.delete(id); }
}

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS social_assets (
    id TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    kind TEXT NOT NULL,
    uri TEXT NOT NULL,
    mime TEXT NOT NULL,
    alt_text TEXT,
    width INT,
    height INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_social_assets_tenant ON social_assets (tenant, created_at DESC)`;
  ready = true;
}

export class NeonAssetStore implements AssetStore {
  constructor(private sql: Sql) {}
  async save(tenant: string, a: Asset) {
    await ensureTable(this.sql);
    await this.sql`INSERT INTO social_assets (id, tenant, kind, uri, mime, alt_text, width, height)
      VALUES (${a.id}, ${tenant}, ${a.kind}, ${a.uri}, ${a.mime}, ${a.altText ?? null}, ${a.width ?? null}, ${a.height ?? null})
      ON CONFLICT (id) DO UPDATE SET alt_text = EXCLUDED.alt_text, width = EXCLUDED.width, height = EXCLUDED.height`;
  }
  async get(id: string) {
    await ensureTable(this.sql);
    const r = (await this.sql`SELECT * FROM social_assets WHERE id = ${id}`) as Record<string, unknown>[];
    return r[0] ? rowToAsset(r[0]) : null;
  }
  async list(tenant: string) {
    await ensureTable(this.sql);
    const r = (await this.sql`SELECT * FROM social_assets WHERE tenant = ${tenant} ORDER BY created_at DESC LIMIT 200`) as Record<string, unknown>[];
    return r.map(rowToAsset);
  }
  async remove(id: string) { await ensureTable(this.sql); await this.sql`DELETE FROM social_assets WHERE id = ${id}`; }
}

function rowToAsset(r: Record<string, unknown>): Asset {
  return {
    id: String(r.id), kind: r.kind as AssetKindMedia, uri: String(r.uri), mime: String(r.mime),
    altText: (r.alt_text as string) ?? undefined,
    width: r.width == null ? undefined : Number(r.width),
    height: r.height == null ? undefined : Number(r.height),
  };
}
