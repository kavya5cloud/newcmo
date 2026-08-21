import type { Reference, ReferenceQuery } from "./types";

// Choosing which references a generation actually sees.
//
// The whole value of a corpus is here, not in its size. Five relevant rows beat five hundred
// general ones, and a hundred thousand rows retrieved badly are worse than ten retrieved
// well — they fill the context window with other people's marketing and crowd out the
// business's own facts.
//
// Deterministic and dependency-free: no embeddings, no model call, no network. Scoring a
// few hundred rows on facet overlap is microseconds, and it is inspectable, which matters
// when someone asks why a particular reference was used. An embedding index is the right
// upgrade at a hundred thousand rows; it is not the right starting point, and it cannot
// explain itself.

/** Facet weights. Channel dominates because a LinkedIn rule rarely transfers to an ad. */
const W = {
  channel: 4,
  industry: 3,
  audience: 2,
  /** Per matching term, capped — a row matching six terms is not six times better. */
  term: 1.5,
  termCap: 4.5,
  kind: 1,
  /** First-party rows outrank the shared library at equal relevance: it is their own data. */
  firstParty: 2.5,
} as const;

const STOP = new Set([
  "the", "a", "an", "and", "or", "but", "for", "with", "your", "you", "it", "this", "that",
  "write", "post", "about", "one", "of", "to", "in", "on", "is", "as", "at", "by", "from",
]);

/** Words worth matching on. Short and stop words carry no signal and match everything. */
export function terms(input: string[]): string[] {
  const out = new Set<string>();
  for (const s of input) {
    for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length > 3 && !STOP.has(raw)) out.add(raw);
    }
  }
  return [...out];
}

/**
 * How well one reference answers one query.
 *
 * A null facet on a reference means "applies broadly" and neither scores nor penalises —
 * that is what keeps a general principle available to every brief without letting it
 * outrank a row written for exactly this channel and audience.
 */
export function scoreReference(r: Reference, q: ReferenceQuery, qTerms: string[]): number {
  let score = 0;

  if (q.channel && r.channel) {
    if (r.channel !== q.channel) return 0; // wrong channel is not a weak match, it is a no
    score += W.channel;
  }
  if (q.industry && r.industry && r.industry.toLowerCase() === q.industry.toLowerCase()) score += W.industry;
  if (q.audience && r.audience && r.audience.toLowerCase() === q.audience.toLowerCase()) score += W.audience;
  if (q.kinds?.length && q.kinds.includes(r.kind)) score += W.kind;

  if (qTerms.length) {
    const hay = `${r.pattern} ${r.evidence} ${r.tags.join(" ")}`.toLowerCase();
    let hits = 0;
    for (const t of qTerms) if (hay.includes(t)) hits++;
    score += Math.min(W.termCap, hits * W.term);
  }

  if (r.workspaceKey) score += W.firstParty;

  return score;
}

/**
 * The references for one generation.
 *
 * Diversity is enforced rather than hoped for: at most two rows of any one kind. Without it
 * a corpus heavy in ad creatives returns five ads for every brief, and the model writes five
 * variations of an ad regardless of what was asked.
 */
export function selectReferences(all: Reference[], q: ReferenceQuery): Reference[] {
  const limit = q.limit ?? 5;
  const qTerms = terms(q.terms ?? []);

  const visible = all.filter((r) => r.workspaceKey === null || r.workspaceKey === q.workspaceKey);
  const scored = visible
    .map((r) => ({ r, score: scoreReference(r, q, qTerms) }))
    .filter((x) => x.score > 0)
    // id as the final tiebreak, so the same brief twice returns the same references and a
    // changed post is attributable to something other than retrieval jitter.
    .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id));

  const out: Reference[] = [];
  const perKind = new Map<string, number>();
  for (const { r } of scored) {
    const n = perKind.get(r.kind) ?? 0;
    if (n >= 2) continue;
    perKind.set(r.kind, n + 1);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * References as prompt text.
 *
 * Two rules are in the wording rather than left to the model's judgement, because both
 * failures are silent and both reach the customer.
 *
 * Attribution travels with every line: a number from another company's campaign must never
 * be repeated as this business's own result, and the only reliable way to prevent that is
 * for the model to see whose number it is at the moment it reads it.
 *
 * And these are patterns to apply, not text to reuse. A corpus fed to a writer without that
 * instruction produces paraphrase, which is the failure mode that makes a reference library
 * a liability rather than an asset.
 */
export function referencesToPrompt(refs: Reference[]): string {
  if (!refs.length) return "";
  const lines = refs.map((r) => {
    const metrics = r.metrics.length
      ? ` (${r.metrics.map((m) => `${m.label} ${m.value}${m.baseline ? ` vs ${m.baseline}` : ""}`).join(", ")})`
      : "";
    const who = r.workspaceKey ? "your own" : r.source.name;
    return `- ${r.pattern}${metrics} — ${r.evidence} [${who}]`;
  });
  return [
    "PROVEN PATTERNS TO APPLY:",
    ...lines,
    "Use these as craft, not as copy: take the technique, write your own words.",
    "Any figure above belongs to whoever is named beside it. Never state one as this business's own result.",
  ].join("\n");
}
