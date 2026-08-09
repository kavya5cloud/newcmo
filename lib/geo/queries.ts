import { MAX_QUERIES } from "./types";

// The questions to ask.
//
// This is the part that decides whether the whole measurement means anything, and it is
// deterministic on purpose — a model choosing its own exam is not a test.
//
// One rule governs everything here: **the query must never contain the brand name.** Ask
// "what should I use for X" and a mention is a finding; ask "tell me about Acme" and the
// model will happily describe Acme whether or not it has ever heard of it. The second
// question measures nothing and would produce a dashboard that always says you are winning.
//
// buyerQueries() enforces this by construction — the brand is never one of its inputs.

export type QueryFacts = {
  /** What the product is, in the words a buyer would use. "invoicing software", "AI CMO". */
  category: string;
  /** Who buys it. "freelancers", "early-stage founders". */
  audience: string;
};

/** Strip anything that would leak the brand or read as marketing rather than a category. */
function cleanCategory(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/&+-]/g, " ")
    .replace(/\b(the|a|an|our|your|best|leading|world class|revolutionary|powerful)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)          // a category is a few words; a sentence is a pitch
    .join(" ");
}

function cleanAudience(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 4)
    .join(" ");
}

/**
 * The questions a buyer actually types.
 *
 * Four shapes, because they fail differently and the difference is informative:
 *
 *   recommendation — "what's the best X for Y". The one that matters commercially.
 *   discovery      — "tools for X". Broader, easier to appear in.
 *   problem        — phrased as the pain, not the product. Catches whether you show up
 *                    for people who do not yet know the category exists.
 *   comparison     — "alternatives to X". Where you appear only if you are known well
 *                    enough to be someone's alternative.
 *
 * Deliberately not templated from a model: the same business must produce the same questions
 * every week, or a change in the result tells you nothing about whether anything changed.
 */
export function buyerQueries(facts: QueryFacts): string[] {
  const category = cleanCategory(facts.category);
  const audience = cleanAudience(facts.audience);
  if (!category) return [];

  const forWhom = audience ? ` for ${audience}` : "";

  const queries = [
    `What is the best ${category}${forWhom}?`,
    `What ${category} tools should I look at${forWhom}?`,
    audience
      ? `I'm ${audience} and I need help with ${category}. What do you recommend?`
      : `I need help with ${category}. What do you recommend?`,
    `What are the most popular ${category} options right now?`,
  ];

  return queries.slice(0, MAX_QUERIES);
}

/**
 * Whether a query is safe to score.
 *
 * A guard rather than a formality: if a brand name ever reaches a query — through a category
 * field someone filled in with their product name, say — the result becomes meaningless in a
 * way nobody would notice from the dashboard, because it would simply always say "mentioned".
 */
export function queryIsFair(query: string, brand: string, host: string): boolean {
  const q = query.toLowerCase();
  const b = (brand || "").toLowerCase().trim();
  const h = (host || "").toLowerCase().replace(/^www\./, "").split(".")[0];
  if (b && b.length > 2 && q.includes(b)) return false;
  if (h && h.length > 2 && q.includes(h)) return false;
  return true;
}
