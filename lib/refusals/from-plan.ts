import type { CandidateStrategy } from "@/lib/cmo/planner";
import type { NewRefusal, RefusalReason } from "./types";

// Turning a plan into a record of what was declined.
//
// planDecision already scores every channel, recommends the best and keeps two alternatives.
// Everything from index three onward is dropped on the floor — and those are the refusals.
// They were considered, scored on eight criteria, and rejected, and until now that judgement
// existed for the length of one function call and was never written down.
//
// This is the honest source. It is not a model asked to invent plausible-sounding skips; it
// is the decision the planner actually made, recorded with the score that drove it.
//
// Nothing here calls an LLM, so a refusal cannot be hallucinated into the ledger — which
// matters more here than anywhere else in the codebase. The one claim this product will make
// that a competitor cannot is built on this table, and a single fabricated row would make the
// whole thing worthless.

/** How many candidates survive. Index 0 is recommended, 1–2 are shown as alternatives. */
const KEPT = 3;

/**
 * Why this candidate lost, from its own score.
 *
 * Ordered by which weakness is most decisive rather than by which number is lowest: a channel
 * nobody in this audience uses is not "slightly worse", it is the wrong channel, and saying
 * "better use of the time" about it would be true and useless.
 */
function reasonFor(c: CandidateStrategy): RefusalReason {
  const s = c.score;
  if (s.businessAlignment < 0.4) return "wrong_audience";
  if (s.expectedImpact < 0.35) return "low_intent";
  if (s.confidence < 0.35) return "no_evidence";
  return "better_use_of_time";
}

/**
 * The sentence a person reads. Built from the same numbers as the reason, so the explanation
 * and the classification can never disagree — which they would within a week if this were a
 * lookup table of generic phrasings.
 */
function explain(c: CandidateStrategy, winner: CandidateStrategy, reason: RefusalReason): string {
  const pct = (n: number) => `${Math.round(n * 100)}`;
  const gap = `${pct(c.score.total)}/100 against ${pct(winner.score.total)} for ${winner.channel}`;
  switch (reason) {
    case "wrong_audience":
      return `Your buyers are not concentrated here — it scored ${pct(c.score.businessAlignment)}/100 on fit, ${gap}.`;
    case "low_intent":
      return `The realistic return does not justify the hours: ${pct(c.score.expectedImpact)}/100 expected impact, ${gap}.`;
    case "no_evidence":
      return `Nothing measured yet says this works for you — ${pct(c.score.confidence)}/100 confidence, ${gap}.`;
    case "better_use_of_time":
      return `Reasonable, and beaten: ${gap}. The same hours go further on ${winner.channel}.`;
    default:
      return gap;
  }
}

/**
 * When the call becomes checkable.
 *
 * Not every refusal ever is. A judgement about audience fit cannot be settled by waiting — no
 * measurement arrives that says "your buyers were here all along" — so it gets no date and
 * stays unknown forever, which is honest. Ones that turn on performance can be revisited once
 * the recommended channel has had time to produce something to compare against.
 */
function checkableAt(reason: RefusalReason, now: number): number | null {
  const DAY = 86_400_000;
  switch (reason) {
    case "better_use_of_time": return now + 30 * DAY;
    case "low_intent": return now + 30 * DAY;
    // Confidence resolves as soon as there is any first-party data at all.
    case "no_evidence": return now + 14 * DAY;
    // Audience fit and duplication are judgements, not predictions. Nothing settles them.
    default: return null;
  }
}

/**
 * The refusals implied by one planning pass.
 *
 * Returns nothing when there was no real choice: with two candidates, declining the second is
 * not a decision worth recording, and padding the ledger with trivial rejections is the
 * fastest way to make its numbers meaningless.
 */
export function refusalsFromPlan(
  candidates: CandidateStrategy[],
  workspaceKey: string,
  now: number,
): NewRefusal[] {
  if (candidates.length <= KEPT) return [];
  const winner = candidates[0];
  return candidates.slice(KEPT).map((c) => {
    const reason = reasonFor(c);
    return {
      workspaceKey,
      proposed: c.title,
      channel: c.channel,
      reason,
      explanation: explain(c, winner, reason),
      insteadDid: winner.title,
      checkableAt: checkableAt(reason, now),
    };
  });
}
