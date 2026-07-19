import type { CreativeChannel } from "@/lib/creative/taxonomy";
import type { Hook, HookCategory } from "./types";
import { clamp01, idFrom } from "./util";

// Hook Engine — a reusable, categorized library of opening hooks with measured
// performance. The Asset Planner / Spec Builder retrieve hooks from here rather than
// inventing them, so winning openers compound over time. Deterministic ranking.

function h(
  category: HookCategory,
  template: string,
  emotion: Hook["emotion"],
  channels: CreativeChannel[],
  performance: number,
  industries: string[] = ["saas", "ai", "b2b"],
  audiences: string[] = ["founders"],
): Hook {
  return {
    id: idFrom("hook", category, template),
    category, template, emotion, industries, audiences, channels,
    performance: clamp01(performance), confidence: clamp01(performance * 0.9 + 0.05), history: [],
  };
}

// Seed library. Slots: {audience} {product} {pain} {metric}.
export const HOOK_LIBRARY: Hook[] = [
  h("curiosity", "The {product} trick {audience} aren't talking about yet.", "curiosity", ["x", "instagram", "video"], 0.82),
  h("curiosity", "What if {pain} was never actually your fault?", "curiosity", ["video", "instagram"], 0.74),
  h("problem", "{audience} waste hours on {pain}. Here's the fix.", "tension", ["linkedin", "x", "video"], 0.79),
  h("problem", "Still doing {pain} by hand? Stop.", "urgency", ["x", "ads"], 0.71),
  h("contrarian", "Everyone says to do more content. They're wrong.", "confidence", ["linkedin", "x"], 0.77),
  h("contrarian", "Unpopular opinion: {product} matters more than your funnel.", "confidence", ["linkedin"], 0.68),
  h("story", "I almost gave up on {pain} — until this.", "aspiration", ["video", "instagram"], 0.8),
  h("story", "6 months ago {audience} like me were stuck. Here's what changed.", "trust", ["video", "linkedin"], 0.72),
  h("educational", "How {audience} actually solve {pain} in 2026.", "confidence", ["linkedin", "articles", "video"], 0.78),
  h("educational", "The 3-step way to fix {pain}.", "confidence", ["video", "articles"], 0.7),
  h("shock", "{metric} of {audience} get {pain} completely wrong.", "tension", ["video", "ads"], 0.69),
  h("statistics", "{metric} improvement in 14 days — here's the playbook.", "confidence", ["linkedin", "ads"], 0.76),
  h("statistics", "We tracked {metric}. The result surprised us.", "curiosity", ["x", "linkedin"], 0.66),
  h("pain_point", "{pain} is quietly killing your growth.", "tension", ["ads", "video"], 0.73),
  h("pain_point", "If {pain} sounds familiar, this is for you.", "trust", ["video", "instagram"], 0.64),
  h("benefits", "Get {metric} without hiring a marketer.", "aspiration", ["ads", "landing", "linkedin"], 0.81),
  h("benefits", "{product}, so {audience} ship faster.", "confidence", ["landing", "x"], 0.67),
];

export type HookQuery = {
  category?: HookCategory;
  channel?: CreativeChannel;
  audience?: string;
  industry?: string;
  emotion?: Hook["emotion"];
};

/** Deterministic relevance score for ranking (0..1). */
function relevance(hook: Hook, q: HookQuery): number {
  let s = hook.performance * 0.6 + hook.confidence * 0.2;
  if (q.category && hook.category === q.category) s += 0.15;
  if (q.channel && hook.channels.includes(q.channel)) s += 0.12;
  if (q.emotion && hook.emotion === q.emotion) s += 0.06;
  if (q.audience && hook.audiences.some((a) => a.toLowerCase() === q.audience!.toLowerCase())) s += 0.05;
  if (q.industry && hook.industries.some((i) => i.toLowerCase() === q.industry!.toLowerCase())) s += 0.05;
  return s;
}

/** Retrieve hooks best-first. Deterministic: ties break by hook id. */
export function retrieveHooks(q: HookQuery = {}, library: Hook[] = HOOK_LIBRARY, limit = 5): Hook[] {
  return [...library]
    .map((hook) => ({ hook, r: relevance(hook, q) }))
    .sort((a, b) => b.r - a.r || a.hook.id.localeCompare(b.hook.id))
    .slice(0, limit)
    .map((x) => x.hook);
}

/** The single best hook for a query (or null if the library is empty). */
export function selectHook(q: HookQuery = {}, library: Hook[] = HOOK_LIBRARY): Hook | null {
  return retrieveHooks(q, library, 1)[0] ?? null;
}

/** Fill a hook template's slots with concrete values. Deterministic. */
export function renderHook(hook: Hook, ctx: { audience?: string; product?: string; pain?: string; metric?: string }): string {
  return hook.template
    .replace(/\{audience\}/g, ctx.audience || "founders")
    .replace(/\{product\}/g, ctx.product || "the product")
    .replace(/\{pain\}/g, ctx.pain || "the busywork")
    .replace(/\{metric\}/g, ctx.metric || "2x results");
}
