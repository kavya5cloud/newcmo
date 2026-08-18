import { marketPlatform } from "@/lib/market/shared";
import { memoryRecord } from "@/lib/market/memory";

// Generation metadata, written where the Learning Engine can already see it.
//
// Deliberately not a new table: Market Memory is the existing versioned, tenant-scoped
// record of "what this workspace observed", the Learning Engine and the Research agent
// already read it, and a fourth store for six fields would be exactly the duplication the
// architecture has avoided so far.
//
// What is recorded is the *shape* of a generation — provider, model, confidence, whether a
// model wrote it at all — so that when those posts report performance, the correlation
// between how something was made and how it did is available rather than lost.

/** How many words of the opener are enough to recognise a repeat without storing the post. */
const OPENER_WORDS = 12;

/** The date, as the model and the cache key both see it. */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * What was written, compressed to the part that must not repeat.
 *
 * Not the post — the *angle*: its title and the first dozen words, which is what a reader
 * recognises as "you already sent me this". Storing the whole body would make the context
 * unaffordable within a week and would not improve the judgement; storing nothing is what
 * the product did until now, which is why Tuesday's post could be Monday's post.
 */
export async function recordComposedAngle(
  tenant: string,
  post: { title: string; body: string },
  now: number = Date.now(),
): Promise<void> {
  const opener = post.body.trim().split(/\s+/).slice(0, OPENER_WORDS).join(" ");
  const title = post.title.trim();
  if (!opener && !title) return;
  const value = title && opener ? `"${title}" — opened with: ${opener}…` : title || `${opener}…`;
  try {
    await marketPlatform().memory.record(memoryRecord(
      // Keyed by day so a workspace generating ten times on Tuesday leaves ten rows rather
      // than overwriting one, and so the list reads back in a legible order.
      tenant, "content", `angle:${dayKey(now)}:${Math.abs(hash(value)).toString(36)}`, value, now, null,
    ));
  } catch {
    // Never fail a generation over its own bookkeeping. The cost of a miss is one possible
    // repeat, which is where the product already was.
  }
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

export type GenerationMeta = {
  tenant: string;
  kind: "content" | "ugc";
  format: string;
  source: "llm" | "deterministic";
  provider: string | null;
  model: string | null;
  confidence: number;
  platforms: number;
  cached?: boolean;
};

export async function recordGeneration(meta: GenerationMeta): Promise<void> {
  const summary = [
    `${meta.kind}/${meta.format}`,
    `via ${meta.source === "llm" ? `${meta.provider ?? "llm"}${meta.model ? `:${meta.model}` : ""}` : "built-in composer"}`,
    `confidence ${Math.round(meta.confidence * 100)}%`,
    `${meta.platforms} platform${meta.platforms === 1 ? "" : "s"}`,
    meta.cached ? "cached" : "",
  ].filter(Boolean).join(" · ");

  // Structured log first: this must be visible even when storage is down.
  console.info(JSON.stringify({ event: "generation", ...meta }));

  try {
    await marketPlatform().memory.record(memoryRecord(
      meta.tenant, "campaign", `generation:${meta.kind}:${meta.format}`, summary, Date.now(), meta.confidence,
    ));
  } catch {
    // Metadata is valuable, not critical. A storage hiccup must never fail a generation
    // the user is waiting on.
  }
}
