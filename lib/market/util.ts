// Deterministic helpers for the market intelligence layer. No randomness, no I/O — the
// same signals always produce the same trends, scores and opportunities, which is what
// makes the whole layer unit-testable.

export function hash(input: string): number {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h;
}

export function idFrom(prefix: string, ...parts: unknown[]): string {
  return `${prefix}_${hash(parts.map(String).join("|")).toString(16).padStart(8, "0")}`;
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

export function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Normalize a topic string so signals about the same thing group together. */
export function normalizeTopic(s: string): string {
  return s.toLowerCase().replace(/[#"'`]/g, "").replace(/\s+/g, " ").trim();
}

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "to", "of", "in", "on", "for", "with", "is", "are",
  "be", "at", "by", "it", "this", "that", "your", "you", "we", "our", "as", "from", "will",
  "how", "why", "what", "new", "best", "top",
]);

/** Content words, for keyword discovery and clustering. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

/** Saturating normalization — turns an unbounded count into 0..1 without inventing scale. */
export function saturate(x: number, k: number): number {
  if (x <= 0) return 0;
  return clamp01(x / (x + k));
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
