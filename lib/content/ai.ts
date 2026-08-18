import { generateText, configuredProviderNames } from "@/lib/services/llm";
import { CRAFT_RULES, CRAFT_BANS, POST_SHAPES, INTERACTION, DISCOVERY, formFor, scoreDraft, rewriteNote } from "./craft";
import { extractJson, LlmJsonError } from "@/lib/llm-json";
import { createAdapterRegistry } from "@/lib/social/registry";
import type { SocialPlatform } from "@/lib/social/types";
import { compose, buildSchedule, FORMAT_META, type ComposeInput, type ComposedContent, type PlatformVariant , cleanHashtags } from "./compose";
import { assembleGenerationContext, contextToPrompt, type GenerationContext } from "./generation-context";
import { dayKey, recordComposedAngle } from "./generation-log";

/**
 * Sampling for copy, as opposed to analysis.
 *
 * The service default is 0.4, chosen to keep *analysis* grounded and JSON reliable. Applied
 * to writing it produces the same sentences for the same brief, which is most of why this
 * product repeated itself. 0.8 is loose enough that two runs diverge and tight enough that
 * the JSON contract still holds — the schema is enforced downstream either way.
 */
const COMPOSE_TEMPERATURE = Number(process.env.COMPOSE_TEMPERATURE || 0.8);

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
    // The date earns its place twice: a model that knows the day stops writing "as we head
    // into the new year" in August, and it is the thing that makes today's brief textually
    // different from yesterday's, which is what breaks the cache.
    `TODAY: ${dayKey(input.now)}`,
    `THE ASK: ${input.prompt}`,
    `FORMAT: ${meta.label} — ${meta.blurb}`,
    ``,
    `CONTEXT YOU MUST USE:`,
    contextToPrompt(ctx),
    ``,
    CRAFT_RULES,
    ``,
    // Shape sits between the sentence rules and the platform rules on purpose: what shape to
    // use is decided before the words, and constrained by where it is going.
    POST_SHAPES,
    ``,
    INTERACTION,
    ``,
    DISCOVERY,
    ``,
    formFor(ctx.platforms.map((p) => p.platform)),
    ``,
    CRAFT_BANS,
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
  opts: {
    signal?: AbortSignal;
    /**
     * Bumped when the user asks for another take on the same brief. Without it, "regenerate"
     * inside the cache window returns the post they were trying to get away from.
     */
    attempt?: number;
  } = {},
): Promise<ComposeResult> {
  if (configuredProviderNames().length === 0) {
    return deterministicResult(input, "No AI provider is configured — set GROQ_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY for model-written copy.");
  }

  const ctx = await assembleGenerationContext({
    tenant: input.tenant, audience: input.audience, terms: [input.prompt], platforms: input.platforms,
  });

  if (opts.signal?.aborted) return deterministicResult(input, "Cancelled before generation started.");

  // The salt is what makes this a request for writing rather than a lookup. The day alone
  // would still hand back the same post to two people asking on the same afternoon, so the
  // attempt rides along with it.
  const cacheSalt = `compose:${dayKey(input.now)}:${opts.attempt ?? 0}`;
  const result = await generateText({ prompt: buildPrompt(input, ctx), cacheSalt, temperature: COMPOSE_TEMPERATURE });
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

  let body = (parsed.body ?? "").trim();
  if (!body) {
    return deterministicResult(input, "The model returned no body text. This draft is from the built-in composer.");
  }

  // One rewrite, and only when the deterministic check finds enough wrong to justify it.
  //
  // A prompt is a request; this is the contract. The scorer catches the faults that can be
  // caught without a model — the stock phrases, the unsourced claim, the opening that would
  // fit any post about anything, the sentences that all run to the same length — and names
  // them back rather than asking for something vaguer and better.
  //
  // Capped at one attempt on purpose. A rewrite loop is how a token budget disappears, and
  // this codebase has already lost a day to exactly that.
  const craft = scoreDraft(body);
  if (craft.needsRewrite && !opts.signal?.aborted) {
    const retry = await generateText({
      prompt: [
        // The instruction has to match the fault. "Keep the format identical — change only the
        // writing" is right for a stock phrase or a flat rhythm, and is a flat contradiction
        // when the fault IS the format: it asks the model to fix the shape while forbidding it
        // from changing the shape. A real generation went round this loop and came back as the
        // same wall, scored identically, and was discarded — the rewrite ran and could not
        // possibly have helped.
        craft.issues.some((i) => i.code === "monotone_shape")
          ? `Rewrite this so it reads like a person wrote it. Keep the argument and the facts; change the SHAPE. Break it onto separate lines, or turn the middle into three dashed items, or end on a line of four words. Returning another single paragraph is a failed rewrite.`
          : `Rewrite this so it reads like a person wrote it. Keep the argument, the facts and the format identical — change only the writing.`,
        ``,
        rewriteNote(craft),
        ``,
        CRAFT_RULES,
        ``,
        // The shapes have to travel with the rewrite. Telling a model its draft is a wall of
        // prose without also showing it the alternatives asks it to invent a structure from a
        // complaint — and it answers by rewording the same paragraph.
        POST_SHAPES,
        ``,
        // The rewrite is what ships. Almost every draft trips a shape check, so this second
        // prompt — not the first — decides what a customer reads, and any guidance missing
        // here is guidance that never reaches the post. DISCOVERY was absent, so hashtags and
        // buyer keywords were added by the draft and then quietly removed by the rewrite.
        //
        // The platform rules go with it for the same reason: LinkedIn wants two or three tags
        // on their own line and X wants none, and a rewrite that does not know where the post
        // is going cannot honour either.
        DISCOVERY,
        ``,
        formFor(ctx.platforms.map((p) => p.platform)),
        ``,
        `Return ONLY the rewritten text. No preamble, no explanation, no quotes around it.`,
        ``,
        `---`,
        body,
      ].join("\n"),
      // The rewrite carries the same salt and heat as the draft. Left on the defaults it
      // would be the one cached, low-temperature step in a path built to be fresh — and it
      // is the step whose output actually ships.
      cacheSalt: `${cacheSalt}:rewrite`,
      temperature: COMPOSE_TEMPERATURE,
    });
    if (retry.ok && retry.text.trim()) {
      const after = scoreDraft(retry.text.trim());
      // Keep it only if it actually improved. A rewrite that scores worse is a worse post.
      if (after.score > craft.score) body = retry.text.trim();
      console.info(JSON.stringify({
        event: "compose_rewrite", before: craft.score, after: after.score,
        kept: after.score > craft.score, issues: craft.issues.map((i) => i.code),
      }));
    }
  }

  // The deterministic composer still owns scheduling: posting windows are an observed
  // model, not a thing to ask a language model to guess at.
  const skeleton = compose(input);
  const title = (parsed.title ?? skeleton.title).trim().slice(0, 200);

  // Write down what was just written, so the next run is told not to write it again. Not
  // awaited: the caller is waiting on a post, not on bookkeeping, and recordComposedAngle
  // swallows its own failures.
  void recordComposedAngle(input.tenant, { title, body }, input.now);

  return {
    composed: {
      ...skeleton,
      title,
      body,
      variants: normalizeVariants(parsed.variants, ctx, body),
      // 8 was never defensible — the rules ask for three and the scorer flags four.
      hashtags: cleanHashtags(parsed.hashtags ?? skeleton.hashtags)
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
