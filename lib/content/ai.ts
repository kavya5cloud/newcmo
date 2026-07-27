import { generateText, configuredProviderNames } from "@/lib/services/llm";
import { extractJson, LlmJsonError } from "@/lib/llm-json";
import { createAdapterRegistry } from "@/lib/social/registry";
import type { SocialPlatform } from "@/lib/social/types";
import { compose, buildSchedule, FORMAT_META, type ComposeInput, type ComposedContent, type PlatformVariant } from "./compose";
import { assembleGenerationContext, contextToPrompt, type GenerationContext } from "./generation-context";

// LLM-backed composition.
//
// Generation goes through lib/services/llm — the existing orchestration that owns provider
// routing (Groq → Gemini → OpenAI), model fallback, retry with backoff, quota handling,
// caching and in-flight de-duplication. Nothing here re-implements any of that, and there
// is no second AI layer.
//
// The deterministic composer is not deleted; it is the floor. With no API key, a refusing
// provider, or output that doesn't parse, the product still returns a usable draft and says
// plainly that a model didn't write it. Silently degrading to worse text with no marker
// would be the one failure mode a founder can't detect.

export type GenerationSource = "llm" | "deterministic";

export type ComposeResult = {
  composed: ComposedContent;
  source: GenerationSource;
  provider: string | null;
  model: string | null;
  /** 0..1 — how much evidence the generation actually had. Never decorative. */
  confidence: number;
  /** Why the output looks the way it does, in plain language. */
  reasoning: string;
  /** Present when the model path was not used, or was used and failed. */
  degradedReason?: string;
  cached: boolean;
};

/** What we ask the model for. Kept small and strict so parsing is reliable. */
type LlmCompose = {
  title?: string;
  body?: string;
  variants?: { platform?: string; text?: string; note?: string }[];
  hashtags?: string[];
  ctas?: string[];
  campaign?: { title?: string; goal?: string; rationale?: string };
  reasoning?: string;
  confidence?: number;
};

function buildPrompt(input: ComposeInput, ctx: GenerationContext): string {
  const meta = FORMAT_META[input.format];
  const platformList = ctx.platforms.length
    ? ctx.platforms.map((p) => `"${p.platform}" (max ${p.maxText} chars)`).join(", ")
    : "none";

  return [
    `Write marketing content as Populr, an AI CMO working for this business.`,
    ``,
    `THE ASK: ${input.prompt}`,
    `FORMAT: ${meta.label} — ${meta.blurb}`,
    ``,
    `CONTEXT YOU MUST USE:`,
    contextToPrompt(ctx),
    ``,
    `RULES`,
    `- Write for ${input.audience}. Specific beats clever.`,
    `- Use the context above. Do not invent statistics, customers, competitors or quotes.`,
    `- Each platform variant must be genuinely rewritten for that platform, not the same text trimmed. Different opening, different rhythm, different length.`,
    `- Every variant must fit its character limit. Count characters.`,
    `- No em-dash-heavy AI cadence, no "in today's fast-paced world", no hype adjectives.`,
    `- confidence: 0..1, honest about how much real evidence the context gave you. Low is fine.`,
    `- reasoning: two sentences on the angle you chose and why.`,
    ``,
    `Return ONLY valid JSON, no markdown fences:`,
    `{`,
    `  "title": string,`,
    `  "body": string,`,
    `  "variants": [{ "platform": one of [${platformList}], "text": string, "note": string }],`,
    `  "hashtags": [string],`,
    `  "ctas": [string, string, string],`,
    `  "campaign": { "title": string, "goal": string, "rationale": string },`,
    `  "reasoning": string,`,
    `  "confidence": number`,
    `}`,
  ].join("\n");
}

const clamp01 = (n: unknown, fallback: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, Number(v.toFixed(3))));
};

/**
 * Enforce platform limits on model output. The model is asked to count characters and is
 * often close, but "often" is not a contract — the adapters are, so a variant that overruns
 * is cut at a sentence boundary exactly as the deterministic path does.
 */
function normalizeVariants(raw: LlmCompose["variants"], ctx: GenerationContext, fallbackText: string): PlatformVariant[] {
  const registry = createAdapterRegistry();
  return ctx.platforms.map((p) => {
    const match = raw?.find((v) => v.platform === p.platform);
    const limit = registry.get(p.platform as SocialPlatform)?.constraints().maxText ?? p.maxText;
    let text = (match?.text ?? fallbackText).trim();
    const overran = text.length > limit;
    if (overran) {
      const cut = text.slice(0, limit);
      const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("\n"));
      text = lastStop > limit * 0.4 ? cut.slice(0, lastStop + 1) : cut.slice(0, limit - 1) + "…";
    }
    return {
      platform: p.platform,
      text,
      length: text.length,
      limit,
      fits: !overran,
      requiresAsset: p.requiresAsset,
      note: overran
        ? `Model output ran past ${p.platform}'s ${limit}-character limit; cut at the last complete sentence.`
        : (match?.note ?? `Written for ${p.platform}.`),
    };
  });
}

function deterministicResult(input: ComposeInput, reason: string): ComposeResult {
  return {
    composed: compose(input),
    source: "deterministic",
    provider: null,
    model: null,
    // The deterministic composer assembles from the prompt's own words. That is reliable,
    // not insightful — the confidence says so rather than flattering it.
    confidence: 0.35,
    reasoning: "Written by the built-in composer from your prompt and each platform's limits.",
    degradedReason: reason,
    cached: false,
  };
}

export async function composeWithAi(
  input: ComposeInput,
  opts: { signal?: AbortSignal } = {},
): Promise<ComposeResult> {
  if (configuredProviderNames().length === 0) {
    return deterministicResult(input, "No AI provider is configured — set GROQ_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY for model-written copy.");
  }

  const ctx = await assembleGenerationContext({
    tenant: input.tenant, audience: input.audience, terms: [input.prompt], platforms: input.platforms,
  });

  if (opts.signal?.aborted) return deterministicResult(input, "Cancelled before generation started.");

  const result = await generateText({ prompt: buildPrompt(input, ctx) });
  if (!result.ok) {
    return deterministicResult(input, `Every AI provider failed (${result.error}). This draft is from the built-in composer.`);
  }
  if (opts.signal?.aborted) return deterministicResult(input, "Cancelled while the model was writing.");

  let parsed: LlmCompose;
  try {
    parsed = extractJson<LlmCompose>(result.text);
  } catch (e) {
    const why = e instanceof LlmJsonError ? e.reason : "unparseable";
    console.warn(JSON.stringify({ event: "compose_parse_failed", reason: why, provider: result.provider, model: result.model }));
    return deterministicResult(input, `The model's response could not be parsed (${why}). This draft is from the built-in composer.`);
  }

  const body = (parsed.body ?? "").trim();
  if (!body) {
    return deterministicResult(input, "The model returned no body text. This draft is from the built-in composer.");
  }

  // The deterministic composer still owns scheduling: posting windows are an observed
  // model, not a thing to ask a language model to guess at.
  const skeleton = compose(input);

  return {
    composed: {
      ...skeleton,
      title: (parsed.title ?? skeleton.title).trim().slice(0, 200),
      body,
      variants: normalizeVariants(parsed.variants, ctx, body),
      hashtags: (parsed.hashtags ?? skeleton.hashtags).filter((h) => typeof h === "string").slice(0, 8)
        .map((h) => (h.startsWith("#") ? h : `#${h}`)),
      ctas: (parsed.ctas ?? skeleton.ctas).filter((c) => typeof c === "string").slice(0, 4),
      schedule: buildSchedule(input.platforms, input.now),
      campaignSuggestion: {
        title: parsed.campaign?.title?.trim() || skeleton.campaignSuggestion.title,
        goal: parsed.campaign?.goal?.trim() || skeleton.campaignSuggestion.goal,
        rationale: parsed.campaign?.rationale?.trim() || skeleton.campaignSuggestion.rationale,
      },
    },
    source: "llm",
    provider: result.provider,
    model: result.model ?? null,
    // Evidence the context actually carried tempers whatever the model claims about itself.
    confidence: clamp01(parsed.confidence, 0.6) * (ctx.missing.length ? 0.8 : 1),
    reasoning: parsed.reasoning?.trim() || "Written from the brand, audience and market context available for this workspace.",
    degradedReason: ctx.missing.length
      ? `Written without: ${ctx.missing.join(", ")}. Confidence is reduced accordingly.`
      : undefined,
    cached: result.cached,
  };
}
