// Shared deterministic helpers for the Creative Intelligence layer. No randomness,
// no I/O — identical inputs always produce identical ids and derived values.

/** Stable, dependency-free hash (djb2). */
export function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Deterministic id: prefix + hash of the parts. */
export function idFrom(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${hash(parts.map((p) => JSON.stringify(p)).join("|"))}`;
}

export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9']+/g) ?? []);
}

/** First meaningful noun-ish token from a brief line, for slotting into templates. */
export function keyPhrase(text: string, fallback: string): string {
  const t = (text || "").trim();
  return t ? t : fallback;
}

/** Pick a stable element from a list based on a seed string (deterministic). */
export function pick<T>(list: readonly T[], seed: string): T {
  if (list.length === 0) throw new Error("pick from empty list");
  const n = parseInt(hash(seed), 16) % list.length;
  return list[n];
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
