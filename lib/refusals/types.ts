// What Populr declined to do, and why.
//
// Every competitor in this category sells volume: more agents, more posts, more channels,
// published automatically. Populr's actual argument is the opposite — that most marketing work
// is not worth doing, and the valuable act is refusing it with a reason attached.
//
// Until now that argument was copy. The landing page said "skipped · won't rank", the dashboard
// said it, and nothing recorded it. A claim nobody keeps score of is a slogan, and a slogan is
// exactly what a competitor can put on their own site by Friday.
//
// This makes it a record. Each refusal is stored with what was proposed, why it was declined,
// what was done instead, and — later, once the window has passed — whether the call was right.
// That last part is the whole point: it is the one claim in this category that cannot be
// asserted, because making it requires having declined things and then having been checked.
//
// The honesty constraint that governs the rest of this codebase applies hardest here. A
// verdict is only ever written from measured evidence. `unknown` is a normal, common, and
// permanent state — most refusals are never conclusively resolved, and saying so is the
// difference between a ledger and a marketing asset.

/** Why a piece of work was declined. Closed set: free-text reasons cannot be counted. */
export type RefusalReason =
  /** The term is owned by sites with far more authority; ranking is implausible. */
  | "unwinnable_search"
  /** The audience for this channel is not this business's audience. */
  | "wrong_audience"
  /** Real intent is too low to be worth a reply — most Reddit threads, most comment sections. */
  | "low_intent"
  /** Already covered by something published; a second piece competes with the first. */
  | "duplicate_effort"
  /** Plausible but far below the best available use of the same hour. */
  | "better_use_of_time"
  /** Would need a claim, number or case study the business does not have. */
  | "no_evidence";

export const REFUSAL_REASONS: RefusalReason[] = [
  "unwinnable_search", "wrong_audience", "low_intent",
  "duplicate_effort", "better_use_of_time", "no_evidence",
];

/** Whether the refusal turned out to be right. */
export type Verdict =
  /** Measured evidence that declining was correct. */
  | "held"
  /** Measured evidence that it was a mistake — the thing would have worked. */
  | "wrong"
  /** No evidence either way. The default, and where most refusals stay. */
  | "unknown";

export type Refusal = {
  id: string;
  workspaceKey: string;
  /** The work that was considered, in the words it would have been proposed in. */
  proposed: string;
  channel: string;
  reason: RefusalReason;
  /** The specific sentence shown to the user. Not a template — the reason for this one. */
  explanation: string;
  /** What was done with the hour instead, when there was an alternative. */
  insteadDid: string | null;
  /**
   * When this becomes checkable. A "won't rank" call cannot be judged for months; a
   * "buyers aren't there this week" call resolves in days. Null means never automatically.
   */
  checkableAt: number | null;
  verdict: Verdict;
  /** What decided the verdict. Required when the verdict is not unknown. */
  evidence: string | null;
  createdAt: number;
  resolvedAt: number | null;
};

export type NewRefusal = Omit<Refusal, "id" | "verdict" | "evidence" | "createdAt" | "resolvedAt">;

/** Human-readable reason, for the UI. Kept beside the type so the two cannot drift. */
export const REASON_LABEL: Record<RefusalReason, string> = {
  unwinnable_search: "Won't rank",
  wrong_audience: "Wrong audience",
  low_intent: "Low intent",
  duplicate_effort: "Already covered",
  better_use_of_time: "Better use of the time",
  no_evidence: "Nothing true to say",
};

/**
 * The count that means something.
 *
 * Deliberately not "34 things skipped" on its own — a refusal count with no verdict attached
 * is a productivity metric for doing nothing, and every tool could claim one. The number worth
 * showing is how many held once they could be checked, which requires the checking to have
 * happened.
 *
 * `pending` and `unknown` are reported rather than hidden. A scorecard that quietly drops the
 * unresolved cases is how a 60% record becomes a 100% one.
 */
export type Scorecard = {
  total: number;
  held: number;
  wrong: number;
  /** Checkable date has not arrived yet. */
  pending: number;
  /** Checkable, checked, and still not conclusive. */
  unknown: number;
  /** held / (held + wrong), or null when nothing has been resolved. Never 0 for "no data". */
  accuracy: number | null;
};

export function scoreRefusals(list: Refusal[], now: number): Scorecard {
  let held = 0, wrong = 0, pending = 0, unknown = 0;
  for (const r of list) {
    if (r.verdict === "held") held++;
    else if (r.verdict === "wrong") wrong++;
    else if (r.checkableAt != null && r.checkableAt > now) pending++;
    else unknown++;
  }
  const decided = held + wrong;
  return {
    total: list.length,
    held, wrong, pending, unknown,
    // Null, not zero. Zero reads as "we were wrong every time"; null reads as "nothing has
    // been checked yet", which is the truth for a new account.
    accuracy: decided === 0 ? null : held / decided,
  };
}
