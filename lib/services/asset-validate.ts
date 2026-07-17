// Pure validation for asset-graph creation — no I/O, tested in tests/asset-validate.test.ts.
// Assets are OBJECTS with graph edges (parent → children), never loose strings: the LLM
// drafts them, but nothing enters the database unless the object contract is complete.

export const ASSET_TYPES = ["blog", "linkedin_post", "x_thread", "reddit_post", "email"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_EVENTS = [
  "generated", "edited", "regenerated", "approved", "rejected", "scheduled", "published", "measured", "archived",
] as const;
export type AssetEvent = (typeof ASSET_EVENTS)[number];

export const ASSET_STATUSES = ["draft", "approved", "rejected", "scheduled", "published", "archived"] as const;

const CHANNEL_FOR_TYPE: Record<AssetType, string> = {
  blog: "articles", linkedin_post: "linkedin", x_thread: "x", reddit_post: "reddit", email: "email",
};

export type AssetInput = {
  clientKey: string;
  parentKey: string | null;   // derivation edge — children come FROM a parent asset
  assetType: AssetType;
  channel: string;
  purpose: string;
  title: string;
  body: string;
  structure: Record<string, unknown> | null;  // typed extras (e.g. x_thread tweets[])
};

export type AssetGraphResult = { ok: true; value: AssetInput[] } | { ok: false; errors: string[] };

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

export function validateAssetGraph(raw: unknown): AssetGraphResult {
  const errors: string[] = [];
  const list = Array.isArray(raw) ? raw : [];
  if (list.length < 1 || list.length > 12) return { ok: false, errors: ["assets"] };

  const keys = new Set<string>();
  const out: AssetInput[] = [];
  list.forEach((a, i) => {
    const o = (a ?? {}) as Record<string, unknown>;
    const clientKey = str(o.clientKey, 60);
    const assetType = String(o.assetType ?? "") as AssetType;
    const title = str(o.title, 300);
    const body = str(o.body, 50_000);
    const purpose = str(o.purpose, 200) || "";
    const parentKey = o.parentKey == null ? null : str(o.parentKey, 60);

    if (!clientKey || keys.has(clientKey)) { errors.push(`assets[${i}].clientKey`); return; }
    if (!ASSET_TYPES.includes(assetType)) { errors.push(`assets[${i}].assetType`); return; }
    if (!title) { errors.push(`assets[${i}].title`); return; }
    if (!body || body.length < 20) { errors.push(`assets[${i}].body`); return; }
    keys.add(clientKey);
    out.push({
      clientKey,
      parentKey: parentKey ?? null,
      assetType,
      channel: CHANNEL_FOR_TYPE[assetType],
      purpose,
      title,
      body,
      structure: o.structure && typeof o.structure === "object" && !Array.isArray(o.structure)
        ? (o.structure as Record<string, unknown>)
        : null,
    });
  });

  // Every parentKey must resolve to another asset in the same batch (graph integrity).
  for (const a of out) {
    if (a.parentKey && !keys.has(a.parentKey)) errors.push(`parent:${a.parentKey}`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}
