import { generateText, configuredProviderNames } from "@/lib/services/llm";
import type { DailyBrief } from "./types";

// The paragraph at the top of the brief.
//
// Goes through lib/services/llm like every other generation. The deterministic version is
// not a placeholder — it is assembled from the same facts and is what ships when no
// provider is configured or a response is unusable. A brief that fails to render because
// an API is down is worse than a plainer sentence.

/** Facts only. The model is asked to phrase these, never to add to them. */
function facts(b: DailyBrief): string[] {
  const f: string[] = [];
  if (b.publishing.today > 0) f.push(`${b.publishing.today} post${b.publishing.today === 1 ? "" : "s"} scheduled today`);
  if (b.publishing.failed > 0) f.push(`${b.publishing.failed} publish${b.publishing.failed === 1 ? "" : "es"} failed`);
  if (b.approvals.count > 0) f.push(`${b.approvals.count} item${b.approvals.count === 1 ? "" : "s"} waiting for approval`);
  if (b.campaigns.running > 0) f.push(`${b.campaigns.running} campaign${b.campaigns.running === 1 ? "" : "s"} running`);
  if (b.campaigns.blocked > 0) f.push(`${b.campaigns.blocked} campaign${b.campaigns.blocked === 1 ? "" : "s"} blocked`);
  if (b.market.competitors.length) f.push(`competitor activity: ${b.market.competitors[0]}`);
  if (b.market.opportunities.length) f.push(`${b.market.opportunities.length} content opportunit${b.market.opportunities.length === 1 ? "y" : "ies"}`);
  if (b.performance.bestPlatform) f.push(`${b.performance.bestPlatform} is the strongest platform so far`);
  if (b.publishing.nextAt) f.push(`next publish ${new Date(b.publishing.nextAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`);
  return f;
}

/** Assembled from the same facts. Plain, correct, and always available. */
export function deterministicSummary(b: DailyBrief): string {
  const f = facts(b);
  if (b.quiet) {
    return `${b.greeting}. Your workspace is quiet — nothing is scheduled and no platforms are connected yet. ${b.recommendation.title} is the fastest way to change that.`;
  }
  if (f.length === 0) {
    return `${b.greeting}. Nothing needs your attention right now. ${b.recommendation.title}.`;
  }
  const head = f.slice(0, 3).join(", ").replace(/,([^,]*)$/, " and$1");
  return `${b.greeting}. ${head.charAt(0).toUpperCase()}${head.slice(1)}. Recommended: ${b.recommendation.title.toLowerCase()}.`;
}

export async function writeSummary(b: DailyBrief): Promise<{ summary: string; source: "llm" | "deterministic" }> {
  if (configuredProviderNames().length === 0) {
    return { summary: deterministicSummary(b), source: "deterministic" };
  }

  const f = facts(b);
  const prompt = [
    `Write the opening paragraph of a marketing brief for a founder, first thing in the morning.`,
    ``,
    `FACTS (use only these — invent nothing):`,
    f.length ? f.map((x) => `- ${x}`).join("\n") : "- nothing is scheduled or running yet",
    ``,
    `RECOMMENDED ACTION: ${b.recommendation.title} — ${b.recommendation.why}`,
    ``,
    `RULES`,
    `- Start with "${b.greeting}".`,
    `- Three or four sentences. No bullet points, no headings.`,
    `- Plain and calm. No hype, no "exciting", no "in today's fast-paced world".`,
    `- Do not invent numbers, percentages, competitors or outcomes not listed above.`,
    `- End by naming the recommended action.`,
    ``,
    `Return only the paragraph.`,
  ].join("\n");

  try {
    const r = await generateText({ prompt });
    if (!r.ok) return { summary: deterministicSummary(b), source: "deterministic" };
    const text = r.text.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").replace(/^["“]|["”]$/g, "").trim();
    // A model that returns a wall of text has ignored the brief; fall back rather than
    // putting an essay where a paragraph belongs.
    if (!text || text.length > 900) return { summary: deterministicSummary(b), source: "deterministic" };
    return { summary: text, source: "llm" };
  } catch {
    return { summary: deterministicSummary(b), source: "deterministic" };
  }
}
