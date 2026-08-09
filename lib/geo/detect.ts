import { CONTEXT_CHARS } from "./types";

// Reading the answer.
//
// Deterministic on purpose. The model's job is to answer the buyer's question; it does not
// get to grade itself. Asking "were you mentioned?" would make the measurement a second
// opinion from the same system being measured, and the failure would be invisible — a model
// that quietly says yes produces a dashboard that always reports good news.
//
// So: plain string matching for the brand, and a heuristic for names. Both are auditable by
// anyone reading the answer text, which is stored alongside the result.

/** Capitalised words that start sentences or are otherwise not product names. */
const NOT_A_NAME = new Set([
  "the", "this", "that", "these", "those", "there", "here", "it", "its", "if", "when", "while",
  "you", "your", "yours", "we", "our", "i", "my", "they", "their", "he", "she",
  "for", "and", "but", "or", "so", "because", "however", "although", "since",
  "a", "an", "some", "many", "most", "several", "few", "each", "every", "both",
  "what", "which", "who", "how", "why", "where",
  "best", "top", "good", "great", "popular", "leading", "key", "main", "other", "another",
  "first", "second", "third", "finally", "overall", "generally", "typically", "usually",
  "note", "important", "consider", "depending", "based", "look", "start", "try", "use",
  "ai", "saas", "seo", "crm", "api", "ui", "ux", "b2b", "b2c", "roi", "kpi",
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);

/** Normalise for comparison: lowercase, strip punctuation and the www/TLD noise. */
function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The distinctive part of a host: acme.com → acme, www.get-acme.io → getacme. */
export function hostStem(host: string): string {
  const bare = (host || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return norm(bare.split(".")[0]);
}

/**
 * Whether the answer names the brand.
 *
 * Matches the brand and the host stem, on a word boundary so "Ace" does not match "Ace
 * Hardware"'s neighbour "space". Short names are the risky case — a two-letter brand matches
 * everything — so anything under three characters is only accepted as a whole word with the
 * exact original casing, which is the best a string match can honestly do.
 */
export function mentionsBrand(answer: string, brand: string, host: string): boolean {
  const text = answer || "";
  const stem = hostStem(host);
  const b = (brand || "").trim();

  if (b.length >= 3) {
    // Compare with punctuation removed so "Populr." and "Populr's" both count.
    const flat = norm(text);
    if (flat.includes(norm(b))) return true;
  } else if (b) {
    if (new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) return true;
  }

  if (stem.length >= 3 && norm(text).includes(stem)) return true;
  return false;
}

/** The passage the brand appears in, so "mentioned" can be checked rather than trusted. */
export function mentionContext(answer: string, brand: string, host: string): string | null {
  const text = (answer || "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const needles = [brand, hostStem(host)].filter((n) => n && n.length >= 3);

  for (const needle of needles) {
    const i = text.toLowerCase().indexOf(needle.toLowerCase());
    if (i === -1) continue;
    // Prefer the sentence; fall back to a window if the answer has no punctuation.
    const start = Math.max(0, text.lastIndexOf(".", i) + 1);
    const endDot = text.indexOf(".", i);
    const end = endDot === -1 ? Math.min(text.length, i + CONTEXT_CHARS) : endDot + 1;
    return text.slice(start, end).trim().slice(0, CONTEXT_CHARS);
  }
  return null;
}

/**
 * Product and company names the answer mentioned.
 *
 * Two passes, strongest signal first. Models listing tools almost always bold them or put
 * them at the head of a numbered item, and those are near-certain to be real names. The
 * general capitalised-sequence pass catches the rest and is where the false positives live,
 * which is why the result is labelled "named" in the UI and never "competitors" — this is a
 * list of names that appeared, and it is presented as exactly that.
 */
export function namedProducts(answer: string, exclude: { brand: string; host: string }): string[] {
  const text = answer || "";
  const found: string[] = [];
  const seen = new Set<string>();
  const excluded = new Set([norm(exclude.brand), hostStem(exclude.host)].filter(Boolean));

  const add = (raw: string) => {
    const name = raw.trim().replace(/[.,:;!?'"]+$/, "").trim();
    if (!name || name.length < 2 || name.length > 40) return;
    const key = norm(name);
    if (!key || seen.has(key) || excluded.has(key)) return;
    if (NOT_A_NAME.has(name.toLowerCase())) return;
    // A multi-word phrase is only a name if its first word is not a stopword.
    if (NOT_A_NAME.has(name.split(/\s+/)[0].toLowerCase())) return;
    seen.add(key);
    found.push(name);
  };

  // Pass 1 — bolded, and the head of a numbered or bulleted item.
  for (const m of text.matchAll(/\*\*([^*\n]{2,40})\*\*/g)) add(m[1]);
  for (const m of text.matchAll(/^\s*(?:[-*•]|\d+[.)])\s+([A-Z][A-Za-z0-9.&+-]*(?:\s+[A-Z][A-Za-z0-9.&+-]*){0,2})/gm)) add(m[1]);

  // Pass 2 — capitalised sequences anywhere, skipping the first word of a sentence, which
  // is capitalised by grammar rather than by being a name.
  for (const m of text.matchAll(/(?:[^.!?\n]\s+)([A-Z][A-Za-z0-9]*(?:[A-Z][a-z]*)?(?:\s+[A-Z][A-Za-z0-9]*){0,2})/g)) add(m[1]);

  return found.slice(0, 8);
}
