// Generative Engine Optimization — measuring whether AI answers mention you.
//
// SEO asks "where do we rank?". GEO asks "when a buyer asks an assistant what to use, does
// our name come up?" — and increasingly that is the question that decides whether a founder
// ever hears of you at all.
//
// The GEO agent used to ship four hardcoded strings claiming results it had never produced
// ("Perplexity cites 2 competitors for your core query"). This is the real thing. Every
// field below exists so a result can be checked by the person reading it: which question was
// asked, which engine answered, when, and what it actually said.

export type CitationOutcome = "mentioned" | "absent";

export type CitationCheck = {
  /** The buyer's question, exactly as it was asked. */
  query: string;
  /** Whether the brand appeared in the answer. */
  outcome: CitationOutcome;
  /**
   * Product or company names the answer did mention.
   *
   * Deterministically extracted, so it is a list of names that appeared — not a curated
   * competitor set. Presented as such: "named instead", never "your competitors".
   */
  named: string[];
  /**
   * The sentence the brand appeared in, when it did.
   *
   * Being mentioned dismissively is not the same as being recommended, and a count alone
   * cannot tell the difference.
   */
  context: string | null;
  /** Which model produced the answer. Shown to the user — never called "ChatGPT". */
  engine: string;
  checkedAt: number;
};

export type CitationReport = {
  tenant: string;
  brand: string;
  host: string;
  checks: CitationCheck[];
  engine: string;
  checkedAt: number;
};

/** How many of the answer's opening characters count as the sentence containing a mention. */
export const CONTEXT_CHARS = 220;

/** A brand is only counted as visible if it appears in an answer to a question about the
 *  category — never one that names the brand. See lib/geo/queries.ts. */
export const MAX_QUERIES = 4;
