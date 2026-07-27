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
