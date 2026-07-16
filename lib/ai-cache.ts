import { createHash } from "node:crypto";
import type { Sql } from "@/lib/db";

// Short-lived caches that cut Groq/LLM usage and page-fetch latency for repeated
// domains. Both are best-effort: every function tolerates a missing table / DB error
// and simply behaves as a cache miss, so the generate route never breaks on cache issues.

// How long a cached AI analysis is served as a fresh hit (default 10 min — inside the
// 5–15 min window). Repeat requests for the same URL+prompt return instantly.
export const ANALYSIS_TTL_MS = Number(process.env.ANALYSIS_CACHE_TTL_MS || 10 * 60_000);
// How stale a cached analysis may be when it's used only as a total-provider-failure
// fallback (default 24h). Better to serve a slightly old analysis than a hard error.
export const ANALYSIS_STALE_MS = Number(process.env.ANALYSIS_STALE_MS || 24 * 60 * 60_000);
// How long an extracted site summary is reused without re-fetching (default 10 min).
export const SITE_TTL_MS = Number(process.env.SITE_CACHE_TTL_MS || 10 * 60_000);

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// Bump this whenever the prompt template or extraction format changes so old cached
// analyses (built by a previous version) are treated as misses and regenerated.
export const CACHE_VERSION = process.env.CACHE_VERSION || "v1";

/** Namespaced, versioned cache key. url+prompt are what actually vary a result. */
export function buildCacheKey(url: string | null, prompt: string): string {
  return sha256(`${CACHE_VERSION}\n${url || ""}\n${prompt}`);
}

let tablesReady = false;
async function ensureCacheTables(sql: Sql) {
  if (tablesReady) return;
  await sql`CREATE TABLE IF NOT EXISTS analysis_cache (
    cache_key TEXT PRIMARY KEY,
    url TEXT,
    result TEXT NOT NULL,
    provider TEXT,
    model TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS site_cache (
    url TEXT PRIMARY KEY,
    html_hash TEXT NOT NULL,
    summary TEXT NOT NULL,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  tablesReady = true;
}

export type CachedAnalysis = { text: string; provider: string | null; model: string | null; ageMs: number };

/**
 * Return a cached analysis for this key no older than maxAgeMs, else null.
 * DELIBERATE: a hit does NOT extend created_at — the analysis cache is a *fixed* TTL
 * from generation time, so even a popular site's analysis is regenerated every TTL and
 * can't go stale forever. (The scrape cache below uses the opposite, sliding policy.)
 */
export async function getCachedAnalysis(sql: Sql, key: string, maxAgeMs: number): Promise<CachedAnalysis | null> {
  try {
    await ensureCacheTables(sql);
    const rows = (await sql`
      SELECT result, provider, model,
             EXTRACT(EPOCH FROM (now() - created_at)) * 1000 AS age_ms
      FROM analysis_cache WHERE cache_key = ${key}`) as {
      result: string; provider: string | null; model: string | null; age_ms: string;
    }[];
    const r = rows[0];
    if (!r) return null;
    const ageMs = Number(r.age_ms);
    if (ageMs > maxAgeMs) return null;
    return { text: r.result, provider: r.provider, model: r.model, ageMs };
  } catch {
    return null;
  }
}

export async function putCachedAnalysis(
  sql: Sql,
  key: string,
  url: string | null,
  result: string,
  provider: string,
  model: string
): Promise<void> {
  try {
    await ensureCacheTables(sql);
    await sql`
      INSERT INTO analysis_cache (cache_key, url, result, provider, model, created_at)
      VALUES (${key}, ${url}, ${result}, ${provider}, ${model}, now())
      ON CONFLICT (cache_key) DO UPDATE SET
        result = EXCLUDED.result, provider = EXCLUDED.provider,
        model = EXCLUDED.model, created_at = now()`;
    await maybeSweep(sql);
  } catch {
    /* best-effort */
  }
}

export type CachedSite = { summary: string; htmlHash: string; ageMs: number };

/** Latest cached site summary for a URL (any age). Caller decides freshness. */
export async function getCachedSite(sql: Sql, url: string): Promise<CachedSite | null> {
  try {
    await ensureCacheTables(sql);
    const rows = (await sql`
      SELECT html_hash, summary,
             EXTRACT(EPOCH FROM (now() - fetched_at)) * 1000 AS age_ms
      FROM site_cache WHERE url = ${url}`) as { html_hash: string; summary: string; age_ms: string }[];
    const r = rows[0];
    if (!r) return null;
    return { summary: r.summary, htmlHash: r.html_hash, ageMs: Number(r.age_ms) };
  } catch {
    return null;
  }
}

export async function putCachedSite(sql: Sql, url: string, htmlHash: string, summary: string): Promise<void> {
  try {
    await ensureCacheTables(sql);
    await sql`
      INSERT INTO site_cache (url, html_hash, summary, fetched_at)
      VALUES (${url}, ${htmlHash}, ${summary}, now())
      ON CONFLICT (url) DO UPDATE SET
        html_hash = EXCLUDED.html_hash, summary = EXCLUDED.summary, fetched_at = now()`;
    await maybeSweep(sql);
  } catch {
    /* best-effort */
  }
}

/**
 * Refresh the fetched_at timestamp when HTML is unchanged (keeps summary "fresh").
 * DELIBERATE: the scrape cache is a *sliding* window — as long as a page's HTML keeps
 * matching, its summary is reused indefinitely without re-extraction.
 */
export async function touchCachedSite(sql: Sql, url: string): Promise<void> {
  try {
    await sql`UPDATE site_cache SET fetched_at = now() WHERE url = ${url}`;
  } catch {
    /* best-effort */
  }
}

// Delete rows past their max useful age. Site rows are kept a bit longer than their
// sliding TTL so a still-valid (HTML-unchanged) summary isn't dropped prematurely.
export async function sweepExpiredCache(sql: Sql): Promise<{ ok: boolean }> {
  try {
    await ensureCacheTables(sql);
    const analysisSecs = Math.ceil(ANALYSIS_STALE_MS / 1000);
    const siteSecs = Math.ceil(Math.max(SITE_TTL_MS * 6, 24 * 60 * 60_000) / 1000);
    await sql`DELETE FROM analysis_cache WHERE created_at < now() - make_interval(secs => ${analysisSecs})`;
    await sql`DELETE FROM site_cache WHERE fetched_at < now() - make_interval(secs => ${siteSecs})`;
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// Probabilistic GC: ~2% of writes trigger a sweep, so expired rows are reaped
// continuously without a dedicated job. A cron can also call sweepExpiredCache directly.
async function maybeSweep(sql: Sql): Promise<void> {
  if (Math.random() < 0.02) await sweepExpiredCache(sql);
}
