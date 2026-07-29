import type { DailyBrief } from "./types";

// The one line under the greeting.
//
// The brief also carries a written paragraph (lib/brief/summary.ts) — that stays, because
// the API contract and the digest that reads it both depend on it. The dashboard does not
// show it. A founder opening the app at 9am is answering one question, "what should I do
// right now?", and a paragraph is a slower way to not answer it.
//
// So: facts only, worst first, at most three, separated by a bullet. Never a sentence that
// has to be read twice.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Highest-stakes first: broken, then blocked, then waiting, then merely happening. */
export function headline(b: DailyBrief): string {
  const parts: string[] = [];
  if (b.publishing.failed > 0) parts.push(plural(b.publishing.failed, "publish failed", "publishes failed"));
  if (b.campaigns.blocked > 0) parts.push(plural(b.campaigns.blocked, "campaign blocked", "campaigns blocked"));
  if (b.approvals.count > 0) parts.push(plural(b.approvals.count, "item to approve", "items to approve"));
  if (b.publishing.today > 0) parts.push(plural(b.publishing.today, "post going out today", "posts going out today"));
  if (b.market.opportunities.length > 0) parts.push(plural(b.market.opportunities.length, "opportunity found", "opportunities found"));
  if (b.campaigns.running > 0) parts.push(plural(b.campaigns.running, "campaign running", "campaigns running"));

  if (parts.length === 0) {
    return b.quiet ? "Nothing set up yet — one step starts it." : "Nothing needs you right now.";
  }
  return parts.slice(0, 3).join(" • ");
}
