import { generateText, configuredProviderNames } from "@/lib/services/llm";
import { mentionContext, mentionsBrand, namedProducts } from "./detect";
import { buyerQueries, queryIsFair, type QueryFacts } from "./queries";
import type { CitationCheck, CitationReport } from "./types";

// Running the check.
//
// For each buyer question: ask a model the question exactly as a buyer would, then read the
// answer deterministically. The model never learns whose visibility is being measured — it
// is answering a question, not performing an audit — which is the only way the answer is
// worth anything.
//
// Returns null rather than a placeholder when no provider is configured. A GEO panel that
// invents a result is the precise thing this feature was built to replace.

export type CheckInput = {
  tenant: string;
  brand: string;
  host: string;
} & QueryFacts;

/**
 * The prompt.
 *
 * Deliberately plain. No system persona, no "you are evaluating", no mention of Populr or
 * the brand — anything that hints an audit is happening changes the answer, and then the
 * measurement describes the prompt rather than the model's actual priors.
 *
 * The length instruction is the one liberty taken, and it is about cost rather than content:
 * an unbounded answer to four questions is a lot of tokens for a check that runs on a
 * schedule, and this codebase has already had one outage caused by exactly that.
 */
function askAsBuyer(query: string): string {
  return `${query}\n\nAnswer in about 120 words, naming specific products where you would normally name them.`;
}

/**
 * Check one question.
 *
 * Exported so a single query can be re-run without paying for the whole set.
 */
export async function checkQuery(
  query: string,
  brand: string,
  host: string,
  now: number = Date.now(),
): Promise<CitationCheck | null> {
  if (!queryIsFair(query, brand, host)) return null;

  const gen = await generateText({ prompt: askAsBuyer(query) });
  if (!gen.ok) return null;

  const answer = gen.text || "";
  const mentioned = mentionsBrand(answer, brand, host);

  return {
    query,
    outcome: mentioned ? "mentioned" : "absent",
    named: namedProducts(answer, { brand, host }),
    context: mentioned ? mentionContext(answer, brand, host) : null,
    engine: gen.model || gen.provider || "unknown",
    checkedAt: now,
  };
}

/**
 * Check every buyer question for a business.
 *
 * Sequential rather than parallel. Four concurrent generations against a provider with a
 * daily token cap is how you exhaust it in one burst, and nothing here is urgent enough to
 * be worth that — the result is read on a dashboard, not in a request path.
 */
export async function runCitationCheck(
  input: CheckInput,
  now: number = Date.now(),
): Promise<CitationReport | null> {
  if (configuredProviderNames().length === 0) return null;

  const queries = buyerQueries({ category: input.category, audience: input.audience })
    .filter((q) => queryIsFair(q, input.brand, input.host));
  if (queries.length === 0) return null;

  const checks: CitationCheck[] = [];
  for (const q of queries) {
    const check = await checkQuery(q, input.brand, input.host, now);
    if (check) checks.push(check);
  }
  if (checks.length === 0) return null;

  console.info(JSON.stringify({
    event: "geo_check",
    tenant: input.tenant,
    queries: checks.length,
    mentioned: checks.filter((c) => c.outcome === "mentioned").length,
    engine: checks[0].engine,
  }));

  return {
    tenant: input.tenant,
    brand: input.brand,
    host: input.host,
    checks,
    engine: checks[0].engine,
    checkedAt: now,
  };
}

/** How many questions named the brand, as a plain sentence for the dashboard. */
export function summarize(report: CitationReport): string {
  const hits = report.checks.filter((c) => c.outcome === "mentioned").length;
  const n = report.checks.length;
  if (hits === 0) return `Not named in any of ${n} buyer question${n === 1 ? "" : "s"}`;
  if (hits === n) return `Named in all ${n} buyer questions`;
  return `Named in ${hits} of ${n} buyer questions`;
}

/**
 * The board items for the GEO agent — real findings, or nothing.
 *
 * Each line states the question asked and what came back, so it can be checked. Where the
 * brand was absent, the names that did appear are the useful part: they are who the model
 * reaches for in that category today.
 */
export function reportToItems(report: CitationReport): [string, string][] {
  return report.checks.slice(0, 3).map((c) => {
    if (c.outcome === "mentioned") {
      return [`Named when asked "${c.query}"`, "View"] as [string, string];
    }
    const named = c.named.slice(0, 2).join(", ");
    return [
      named
        ? `Not named for "${c.query}" — it named ${named}`
        : `Not named for "${c.query}"`,
      "Fix gap",
    ] as [string, string];
  });
}
