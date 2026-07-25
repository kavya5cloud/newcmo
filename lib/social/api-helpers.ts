import type { Asset, PostContent, SocialPlatform } from "./types";
import { SOCIAL_PLATFORMS } from "./types";

// Small shared parsers for the social API routes (keeps request handling DRY + typed).

export function readPlatform(v: unknown): SocialPlatform | null {
  const s = String(v || "");
  return (SOCIAL_PLATFORMS as readonly string[]).includes(s) ? (s as SocialPlatform) : null;
}

export function readContent(v: unknown): PostContent {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    text: String(o.text ?? ""),
    assetIds: Array.isArray(o.assetIds) ? o.assetIds.map(String) : [],
    linkUrl: typeof o.linkUrl === "string" ? o.linkUrl : undefined,
    firstComment: typeof o.firstComment === "string" ? o.firstComment : undefined,
  };
}

const ASSET_KINDS = ["image", "video", "gif", "document"];
export function readAssets(v: unknown): Asset[] {
  if (!Array.isArray(v)) return [];
  return v.map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const kind = ASSET_KINDS.includes(String(o.kind)) ? (o.kind as Asset["kind"]) : "image";
    return {
      id: typeof o.id === "string" ? o.id : `ast_${i}_${String(o.uri ?? "").slice(-8)}`,
      kind, uri: String(o.uri ?? `populr://media/${i}`), mime: String(o.mime ?? "image/png"),
      altText: typeof o.altText === "string" ? o.altText : undefined,
      width: typeof o.width === "number" ? o.width : undefined,
      height: typeof o.height === "number" ? o.height : undefined,
    };
  });
}
