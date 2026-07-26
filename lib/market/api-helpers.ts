import type { MarketQuery } from "./types";

// Shared request parsing for the market API routes — keeps the handlers thin and typed.

export function readQuery(src: Record<string, unknown>, tenant: string): MarketQuery {
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String).filter(Boolean)
      : typeof v === "string" && v ? v.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
  return {
    tenant,
    terms: list(src.terms),
    competitors: list(src.competitors),
    industry: typeof src.industry === "string" ? src.industry : undefined,
    audience: typeof src.audience === "string" ? src.audience : undefined,
    since: typeof src.since === "number" ? src.since : undefined,
    limit: typeof src.limit === "number" ? Math.min(50, Math.max(1, src.limit)) : undefined,
  };
}

export function readPaging(p: URLSearchParams): { offset: number; limit: number } {
  return {
    offset: Math.max(0, Number(p.get("offset")) || 0),
    limit: Math.min(100, Math.max(1, Number(p.get("limit")) || 25)),
  };
}
