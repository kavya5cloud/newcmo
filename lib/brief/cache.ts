import type { DailyBrief } from "./types";

// Caching the brief.
//
// Assembling it reads six engines and may call a model, so it is not something to do on
// every page load. But a stale brief is worse than a slow one: it tells someone three
// posts are scheduled after they cancelled them.
//
// So the cache is keyed on a fingerprint of the inputs. A hit is only served when the
// world still looks the way it did — which means publishing, campaign, market, learning
// and approval changes all invalidate it without any of them needing to know the cache
// exists.

export type CacheEntry = { brief: DailyBrief; storedAt: number };

/** Time-based ceiling, so an unchanged world still refreshes its wording eventually. */
export const MAX_AGE_MS = 15 * 60_000;

const store = new Map<string, CacheEntry>();

export function readCache(tenant: string, now: number): CacheEntry | null {
  const hit = store.get(tenant);
  if (!hit) return null;
  if (now - hit.storedAt > MAX_AGE_MS) { store.delete(tenant); return null; }
  return hit;
}

export function writeCache(tenant: string, brief: DailyBrief, now: number): void {
  store.set(tenant, { brief, storedAt: now });
}

/** Fresh only when nothing the brief depends on has changed. */
export function isFresh(hit: CacheEntry | null, signature: string, now: number): boolean {
  if (!hit) return false;
  if (now - hit.storedAt > MAX_AGE_MS) return false;
  return hit.brief.signature === signature;
}

export function invalidate(tenant: string): void {
  store.delete(tenant);
}

/** Test seam. */
export function clearAll(): void {
  store.clear();
}
