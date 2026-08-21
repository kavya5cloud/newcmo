import type { SocialPlatform } from "@/lib/social/types";

// The Marketing Intelligence Layer — what Populr reads before it writes.
//
// The Learning Engine already answers "what worked for THIS business", and it is empty on
// day one, which is the gap this fills: a body of marketing craft that exists before a
// workspace has published anything.
//
// The design constraint is the one that governs the rest of this codebase. A reference is
// only allowed to assert a number if it can say where the number came from — see
// `assertCitable`. That is enforced at the store boundary rather than left to whoever adds
// rows, because a corpus is exactly the place where an unsourced claim survives: it gets
// written once, read into thousands of prompts, and comes out of the model as fact in the
// customer's own voice.
//
// Volume is deliberately not the goal. A generation uses a handful of references; the rest
// are a number for a launch post. Relevance and provenance are what change the output.

/** What kind of artefact a reference describes. */
export const REFERENCE_KINDS = [
  /** A transferable rule of craft. Makes no empirical claim on its own. */
  "principle",
  /** A specific ad creative, with its hook and angle. */
  "ad",
  /** An email, its subject line and its structure. */
  "email",
  /** An organic post that did unusually well. */
  "post",
  /** A sequence of moves, not a single artefact. */
  "playbook",
  /** How a brand sounds and looks, as a reference point. */
  "brand",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

/**
 * Where a reference came from.
 *
 * `licence` is not decoration. It records what we are allowed to do with the row, and the
 * library page shows it, because the honest answer to "where did you get 100,000 ads" is a
 * field in the database rather than a sentence in a launch post.
 */
export type ReferenceSource = {
  /** Human-readable origin: a publication, a brand, a workspace, a licensed feed. */
  name: string;
  /** Checkable link, where one exists. Null for first-party rows. */
  url: string | null;
  /**
   * How this row may be used.
   *   first_party  — the customer's own data. Never leaves their workspace.
   *   public_api   — retrieved from an official API under its terms.
   *   licensed     — obtained under a commercial agreement.
   *   original     — written by us.
   */
  licence: "first_party" | "public_api" | "licensed" | "original";
  /** When the underlying artefact is from, not when we ingested it. */
  observedAt: number | null;
};

/** A measured claim. Optional — most references are craft, not statistics. */
export type ReferenceMetric = {
  label: string;
  value: string;
  /** What was compared against. A number with no baseline is a decoration. */
  baseline: string | null;
};

export type Reference = {
  id: string;
  kind: ReferenceKind;
  /**
   * Whose reference this is. Null means the shared library, readable by every workspace.
   * A workspace key means it is private to that workspace and never surfaces elsewhere —
   * the distinction the Pattern Library did not make, which is how one business's numbers
   * ended up in another's prompt.
   */
  workspaceKey: string | null;
  /** The transferable lesson, in one sentence. This is what reaches the prompt. */
  pattern: string;
  /** What supports it: the creative, the structure, the observation. */
  evidence: string;
  /** Verbatim excerpt, where quoting is permitted by the licence. Kept short. */
  excerpt: string | null;
  metrics: ReferenceMetric[];
  source: ReferenceSource;
  /** Retrieval facets. Null means "applies broadly" and matches anything. */
  channel: SocialPlatform | "email" | "ads" | "web" | null;
  industry: string | null;
  audience: string | null;
  /** Free tags for retrieval — "hook", "cta", "b2b", "launch". */
  tags: string[];
  createdAt: number;
};

export type NewReference = Omit<Reference, "id" | "createdAt">;

/**
 * The honesty rule, enforced rather than documented.
 *
 * A reference carrying metrics must name a source with a URL. Without that, a number in the
 * corpus is indistinguishable from a number a model invented — and it is worse than one,
 * because it arrives with the authority of a database row and gets repeated to customers as
 * research.
 *
 * Deliberately a hard throw at the store boundary. Filtering silently would let a bad row
 * be added, appear to succeed, and vanish.
 */
export function assertCitable(r: NewReference): void {
  if (r.metrics.length === 0) return;
  if (r.source.licence === "first_party") return; // the customer's own measured data
  if (!r.source.url) {
    throw new Error(
      `Reference "${r.pattern.slice(0, 60)}" claims ${r.metrics.length} metric(s) with no source URL. ` +
      `Add source.url, or drop the metrics and state it as a principle.`,
    );
  }
}

/** Retrieval query. Every facet is optional; an empty query returns the broadest rows. */
export type ReferenceQuery = {
  /** The workspace asking. Its private rows plus the shared library. */
  workspaceKey: string;
  channel?: Reference["channel"];
  industry?: string | null;
  audience?: string | null;
  /** Words from the brief — the angle, the form, the ask. */
  terms?: string[];
  kinds?: ReferenceKind[];
  limit?: number;
};
