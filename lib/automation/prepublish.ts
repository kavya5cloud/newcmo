import { generateText, configuredProviderNames } from "@/lib/services/llm";
import { extractJson } from "@/lib/llm-json";
import { createAdapterRegistry } from "@/lib/social/registry";
import type { SocialPlatform } from "@/lib/social/types";

// The single pre-publish pipeline.
//
// Everything that reaches a platform passes through here, whoever wrote it — the AI queue,
// a hand-written draft, a campaign asset, a template, an approved UGC caption. One path,
// so a rule about hashtags or alt text cannot be true for generated posts and false for
// drafts.
//
// Validation and optimisation are deliberately separate. Validation says whether something
// may publish; optimisation makes it better. Only validation can block — an optimiser that
// can veto a publish is an optimiser that takes the account offline when a provider is down.

export type Severity = "error" | "warning";

export type ValidationIssue = {
  code:
    | "over_limit" | "empty" | "media_required" | "too_many_assets" | "video_unsupported"
    | "invalid_url" | "insecure_url" | "missing_alt_text" | "missing_cta" | "duplicate_content";
  severity: Severity;
  /** Plain language, with the fix. Never a bare code. */
  message: string;
};

export type ValidationResult = {
  ok: boolean;                      // false when any error is present
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
};

export type PrePublishContent = {
  text: string;
  assetIds: string[];
  /** Alt text per asset id. Missing entries are an accessibility warning. */
  altText?: Record<string, string>;
};

export type ValidateContext = {
  platform: SocialPlatform;
  /** Text of everything already scheduled, to catch a duplicate before it posts twice. */
  scheduledTexts?: string[];
};

// A URL shape check, not a reachability check. Fetching every link on the publish path
// would add latency and a new failure mode to every post; malformed and insecure links
// are the ones that are actually caught this way.
const URL_RE = /https?:\/\/[^\s<>"')]+/gi;

function checkLinks(text: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const raw of text.match(URL_RE) ?? []) {
    let parsed: URL | null = null;
    try { parsed = new URL(raw); } catch { parsed = null; }
    if (!parsed || !parsed.hostname.includes(".")) {
      issues.push({ code: "invalid_url", severity: "error", message: `“${raw}” is not a valid link. Fix or remove it before publishing.` });
      continue;
    }
    if (parsed.protocol === "http:") {
      issues.push({ code: "insecure_url", severity: "warning", message: `${parsed.hostname} is linked over http. Use https so the link isn't flagged.` });
    }
  }
  return issues;
}

/** A call to action is a verb aimed at the reader, or a link. Heuristic, and warned only. */
function hasCta(text: string): boolean {
  return /\b(try|start|join|read|watch|book|get|see|learn|sign up|subscribe|download|reply|comment|follow)\b/i.test(text)
    || URL_RE.test(text);
}

/** Normalised text for duplicate detection — punctuation and case are not the message. */
function fingerprint(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Everything that decides whether content may publish.
 *
 * Errors block. Warnings are recorded and shown but never stop a post — a missing CTA is
 * a judgement call, and a pipeline that refuses to publish over one trains people to
 * bypass it.
 */
export function validate(content: PrePublishContent, ctx: ValidateContext): ValidationResult {
  const issues: ValidationIssue[] = [];
  const text = content.text ?? "";
  // Content crosses a boundary from six different sources; a missing array must produce a
  // validation result, not a TypeError inside the publish path.
  const assetIds = content.assetIds ?? [];
  const registry = createAdapterRegistry();
  const constraints = registry.get(ctx.platform)?.constraints();

  if (!text.trim()) {
    issues.push({ code: "empty", severity: "error", message: "There is nothing to publish." });
  }

  if (constraints) {
    if (text.length > constraints.maxText) {
      issues.push({
        code: "over_limit", severity: "error",
        message: `${text.length} characters exceeds ${ctx.platform}'s limit of ${constraints.maxText}.`,
      });
    }
    if (constraints.requiresAsset && assetIds.length === 0) {
      issues.push({
        code: "media_required", severity: "error",
        message: `${ctx.platform} requires an image or video. Attach media before publishing.`,
      });
    }
    if (assetIds.length > constraints.maxAssets) {
      issues.push({
        code: "too_many_assets", severity: "error",
        message: `${assetIds.length} assets exceeds ${ctx.platform}'s maximum of ${constraints.maxAssets}.`,
      });
    }
  }

  issues.push(...checkLinks(text));

  // Accessibility is not optional, but a missing description should not stop a post going
  // out — it is recorded so it can be fixed and so the gap is visible.
  for (const id of assetIds) {
    if (!content.altText?.[id]?.trim()) {
      issues.push({ code: "missing_alt_text", severity: "warning", message: `Asset ${id} has no alt text. Screen readers will skip it.` });
    }
  }

  if (text.trim() && !hasCta(text)) {
    issues.push({ code: "missing_cta", severity: "warning", message: "No call to action — the reader isn't told what to do next." });
  }

  const fp = fingerprint(text);
  if (fp && ctx.scheduledTexts?.some((t) => fingerprint(t) === fp)) {
    issues.push({
      code: "duplicate_content", severity: "error",
      message: "Identical content is already scheduled. Publishing both would post the same thing twice.",
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  return { ok: errors.length === 0, issues, errors, warnings: issues.filter((i) => i.severity === "warning") };
}

// ---- Optimisation ----

export type Optimization = {
  /** Never overwritten — the original is kept so a user can compare and revert. */
  original: PrePublishContent;
  optimized: PrePublishContent;
  /** What actually changed, named. */
  applied: string[];
  source: "llm" | "deterministic";
  provider: string | null;
  model: string | null;
  confidence: number;
  reasoning: string;
};

/**
 * Deterministic optimiser — the floor.
 *
 * Only changes it can make safely without judgement: trim to the platform limit at a
 * sentence boundary, and derive alt text from the post's own first line rather than
 * leaving an image undescribed.
 */
export function deterministicOptimize(content: PrePublishContent, platform: SocialPlatform): Optimization {
  const registry = createAdapterRegistry();
  const limit = registry.get(platform)?.constraints().maxText ?? content.text.length;
  const applied: string[] = [];

  let text = content.text.trim();
  if (text.length > limit) {
    const cut = text.slice(0, limit);
    const stop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("\n"));
    text = stop > limit * 0.4 ? cut.slice(0, stop + 1) : cut.slice(0, limit - 1) + "…";
    applied.push(`trimmed to ${platform}'s ${limit}-character limit`);
  }

  const assetIds = content.assetIds ?? [];
  const altText = { ...(content.altText ?? {}) };
  for (const id of assetIds) {
    if (!altText[id]?.trim()) {
      altText[id] = text.split("\n")[0].slice(0, 120) || "Image accompanying this post";
      applied.push(`alt text for ${id}`);
    }
  }

  return {
    original: content,
    optimized: { text, assetIds, altText },
    applied,
    source: "deterministic",
    provider: null, model: null,
    confidence: 0.3,
    reasoning: "Applied the changes that need no judgement: platform trimming and alt text.",
  };
}

export type OptimizeContext = {
  platform: SocialPlatform;
  /** Brand voice, audience and market context — supplied by the caller, not fetched here. */
  contextPrompt?: string;
  signal?: AbortSignal;
};

type LlmOptimization = {
  text?: string;
  altText?: Record<string, string>;
  applied?: string[];
  reasoning?: string;
  confidence?: number;
};

/**
 * Improve content for one platform through the existing LLM orchestration.
 *
 * Falls back to the deterministic optimiser on a missing key, a failing provider or an
 * unparseable response. Optimisation must never be able to block a publish — the original
 * is still there, and shipping the original beats shipping nothing.
 */
export async function optimize(content: PrePublishContent, ctx: OptimizeContext): Promise<Optimization> {
  if (configuredProviderNames().length === 0 || ctx.signal?.aborted) {
    return deterministicOptimize(content, ctx.platform);
  }

  const registry = createAdapterRegistry();
  const k = registry.get(ctx.platform)?.constraints();
  const prompt = [
    `Improve this ${ctx.platform} post. Return the improved post, not commentary.`,
    ``,
    `POST:`,
    content.text,
    ``,
    ctx.contextPrompt ? `CONTEXT:\n${ctx.contextPrompt}\n` : "",
    `RULES`,
    k ? `- Hard limit ${k.maxText} characters. Count them.` : "",
    `- Rewrite for ${ctx.platform} specifically: its rhythm, its length, its conventions.`,
    `- Keep every fact. Do not invent numbers, customers or claims.`,
    `- End with a clear call to action.`,
    `- Add hashtags only where the platform expects them, at most four.`,
    `- Fix grammar and readability. No hype adjectives, no "in today's fast-paced world".`,
    `- Emoji only if that platform's audience expects them, and at most two.`,
    content.assetIds.length ? `- Write alt text for each of: ${content.assetIds.join(", ")}. Describe what is in the image.` : "",
    ``,
    `Return ONLY JSON, no fences:`,
    `{ "text": string, "altText": { "assetId": "description" }, "applied": [string], "reasoning": string, "confidence": number }`,
  ].filter(Boolean).join("\n");

  const result = await generateText({ prompt });
  if (!result.ok || ctx.signal?.aborted) return deterministicOptimize(content, ctx.platform);

  let parsed: LlmOptimization;
  try { parsed = extractJson<LlmOptimization>(result.text); }
  catch { return deterministicOptimize(content, ctx.platform); }

  const text = (parsed.text ?? "").trim();
  if (!text) return deterministicOptimize(content, ctx.platform);

  // The model is asked to count characters and is usually close; the adapter is the
  // contract. Re-apply the deterministic trim over whatever came back.
  const floor = deterministicOptimize(
    { text, assetIds: content.assetIds, altText: { ...(content.altText ?? {}), ...(parsed.altText ?? {}) } },
    ctx.platform,
  );

  return {
    original: content,
    optimized: floor.optimized,
    applied: [...(parsed.applied ?? []).filter((a) => typeof a === "string"), ...floor.applied],
    source: "llm",
    provider: result.provider,
    model: result.model ?? null,
    confidence: Math.max(0, Math.min(1, typeof parsed.confidence === "number" ? parsed.confidence : 0.6)),
    reasoning: parsed.reasoning?.trim() || "Rewritten for this platform.",
  };
}

export type PrePublishResult = {
  /** What should actually be published. Null when validation blocked it. */
  publishable: PrePublishContent | null;
  optimization: Optimization;
  /** Validation of the optimised content — what would actually go out. */
  validation: ValidationResult;
  /** Validation of the original, so a fix introduced by optimisation is visible. */
  before: ValidationResult;
};

/**
 * The one pipeline: optimise, then validate what would actually publish.
 *
 * Optimisation runs first so it can fix what validation would otherwise reject — an
 * over-long draft is trimmed rather than refused. Validation then has the final say on
 * the text that will really go out, not the text someone started with.
 */
export async function prePublish(
  content: PrePublishContent,
  ctx: OptimizeContext & { scheduledTexts?: string[] },
): Promise<PrePublishResult> {
  const before = validate(content, { platform: ctx.platform, scheduledTexts: ctx.scheduledTexts });
  const optimization = await optimize(content, ctx);
  const validation = validate(optimization.optimized, { platform: ctx.platform, scheduledTexts: ctx.scheduledTexts });

  return {
    publishable: validation.ok ? optimization.optimized : null,
    optimization,
    validation,
    before,
  };
}
