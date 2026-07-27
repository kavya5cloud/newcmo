import { generateText, configuredProviderNames } from "@/lib/services/llm";
import { extractJson, LlmJsonError } from "@/lib/llm-json";
import { assembleGenerationContext, contextToPrompt, type GenerationContext } from "@/lib/content/generation-context";
import { generateUgc } from "./engine";
import {
  CREATOR_STYLE_META, FORMAT_META, VOICE_STYLE_META,
  type Cta, type Hook, type ScriptScene, type UgcBrief, type UgcPackage, type UgcVersion,
} from "./types";

// LLM-backed UGC generation, through the same lib/services/llm orchestration as everything
// else. The deterministic engine remains the floor: no key, a failing provider, or output
// that doesn't parse still produces a usable package, marked as such.

export type UgcResult = {
  package: UgcPackage;
  source: "llm" | "deterministic";
  provider: string | null;
  model: string | null;
  confidence: number;
  reasoning: string;
  degradedReason?: string;
};

type LlmUgc = {
  hooks?: { text?: string; rationale?: string; strength?: number }[];
  talkingPoints?: string[];
  versions?: {
    label?: string;
    hook?: string;
    scenes?: { at?: number; line?: string; visual?: string }[];
    caption?: string;
    hashtags?: string[];
    cta?: string;
    voiceDirection?: string;
  }[];
  ctas?: string[];
  reasoning?: string;
  confidence?: number;
};

function buildPrompt(brief: UgcBrief, count: number, ctx: GenerationContext): string {
  const f = FORMAT_META[brief.format];
  return [
    `Write user-generated-content video scripts for a real creator to film. Not an ad read.`,
    ``,
    `PRODUCT: ${brief.product}`,
    `AUDIENCE: ${brief.audience}`,
    `THE CHANGE IT CREATES: ${brief.outcome}`,
    brief.objection ? `OBJECTION TO ADDRESS HEAD-ON: ${brief.objection}` : ``,
    `FORMAT: ${f.label} — ${f.blurb} Target ${f.seconds} seconds.`,
    `CREATOR STANCE: ${CREATOR_STYLE_META[brief.creatorStyle].stance}`,
    `DELIVERY: ${VOICE_STYLE_META[brief.voiceStyle].direction}`,
    ``,
    `CONTEXT YOU MUST USE:`,
    contextToPrompt(ctx),
    ``,
    `RULES`,
    `- Write how people actually talk on camera. Contractions, short sentences, no marketing voice.`,
    `- Every scene needs the spoken line AND what is on screen.`,
    `- ${count} versions, each a genuinely different read — different opening, different angle. Never the same script relabelled.`,
    `- Hooks must earn the first two seconds. Give the reason each one works.`,
    `- Do not invent testimonials, numbers, or named customers.`,
    `- confidence: 0..1, honest about the evidence you had.`,
    ``,
    `Return ONLY valid JSON, no markdown fences:`,
    `{`,
    `  "hooks": [{ "text": string, "rationale": string, "strength": number }],`,
    `  "talkingPoints": [string],`,
    `  "versions": [{ "label": string, "hook": string, "scenes": [{ "at": number, "line": string, "visual": string }], "caption": string, "hashtags": [string], "cta": string, "voiceDirection": string }],`,
    `  "ctas": [string],`,
    `  "reasoning": string,`,
    `  "confidence": number`,
    `}`,
  ].filter(Boolean).join("\n");
}

const clamp01 = (n: unknown, fallback: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, Number(v.toFixed(3))));
};

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function deterministic(tenant: string, brief: UgcBrief, count: number, reason: string): UgcResult {
  return {
    package: generateUgc(tenant, brief, { versions: count }),
    source: "deterministic",
    provider: null,
    model: null,
    confidence: 0.35,
    reasoning: "Scripted by the built-in engine from your brief and the format's structure.",
    degradedReason: reason,
  };
}

export async function generateUgcWithAi(
  tenant: string,
  brief: UgcBrief,
  opts: { versions?: number; signal?: AbortSignal } = {},
): Promise<UgcResult> {
  const count = Math.max(1, Math.min(5, opts.versions ?? 3));

  if (configuredProviderNames().length === 0) {
    return deterministic(tenant, brief, count, "No AI provider is configured — set GROQ_API_KEY, GEMINI_API_KEY or OPENAI_API_KEY for model-written scripts.");
  }

  const ctx = await assembleGenerationContext({
    tenant, audience: brief.audience, terms: [brief.product, brief.outcome],
  });
  if (opts.signal?.aborted) return deterministic(tenant, brief, count, "Cancelled before generation started.");

  const result = await generateText({ prompt: buildPrompt(brief, count, ctx) });
  if (!result.ok) {
    return deterministic(tenant, brief, count, `Every AI provider failed (${result.error}). These scripts are from the built-in engine.`);
  }
  if (opts.signal?.aborted) return deterministic(tenant, brief, count, "Cancelled while the model was writing.");

  let parsed: LlmUgc;
  try {
    parsed = extractJson<LlmUgc>(result.text);
  } catch (e) {
    const why = e instanceof LlmJsonError ? e.reason : "unparseable";
    console.warn(JSON.stringify({ event: "ugc_parse_failed", reason: why, provider: result.provider, model: result.model }));
    return deterministic(tenant, brief, count, `The model's response could not be parsed (${why}). These scripts are from the built-in engine.`);
  }

  const rawVersions = (parsed.versions ?? []).filter((v) => Array.isArray(v.scenes) && v.scenes.length > 0);
  if (rawVersions.length === 0) {
    return deterministic(tenant, brief, count, "The model returned no usable scripts. These are from the built-in engine.");
  }

  // The deterministic package supplies ids and any field the model omitted, so a partial
  // response degrades field by field instead of failing the whole request.
  const skeleton = generateUgc(tenant, brief, { versions: count });

  const hooks: Hook[] = (parsed.hooks ?? [])
    .filter((h) => typeof h.text === "string" && h.text.trim())
    .slice(0, 5)
    .map((h, i) => ({
      id: skeleton.hooks[i]?.id ?? `hook_llm_${i}`,
      text: h.text!.trim(),
      rationale: h.rationale?.trim() || "No rationale returned for this hook.",
      strength: clamp01(h.strength, 0.6),
    }));

  const ctas: Cta[] = (parsed.ctas ?? []).filter((c) => typeof c === "string" && c.trim()).slice(0, 3)
    .map((c, i) => ({ id: skeleton.ctas[i]?.id ?? `cta_llm_${i}`, text: c.trim(), kind: (["soft", "direct", "curiosity"] as const)[i] ?? "direct" }));

  const versions: UgcVersion[] = rawVersions.slice(0, count).map((v, i) => {
    const base = skeleton.versions[i] ?? skeleton.versions[0];
    const scenes: ScriptScene[] = v.scenes!
      .filter((s) => typeof s.line === "string" && s.line.trim())
      .map((s, idx) => ({
        index: idx,
        at: typeof s.at === "number" && Number.isFinite(s.at) ? Math.max(0, Math.round(s.at)) : Math.round((idx * FORMAT_META[brief.format].seconds) / Math.max(1, v.scenes!.length)),
        line: s.line!.trim(),
        visual: s.visual?.trim() || "No visual direction returned for this beat.",
      }));
    const hookText = v.hook?.trim() || hooks[i]?.text || base.hook.text;
    return {
      ...base,
      label: v.label?.trim() || base.label,
      hook: hooks.find((h) => h.text === hookText) ?? { ...base.hook, text: hookText },
      scenes: scenes.length ? scenes : base.scenes,
      cta: ctas[i % Math.max(1, ctas.length)] ?? base.cta,
      caption: v.caption?.trim() || base.caption,
      hashtags: (v.hashtags ?? base.hashtags).filter((h) => typeof h === "string")
        .map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 8),
      voiceDirection: v.voiceDirection?.trim() || base.voiceDirection,
      wordCount: words((scenes.length ? scenes : base.scenes).map((s) => s.line).join(" ")),
      status: "draft" as const,
    };
  });

  return {
    package: {
      ...skeleton,
      hooks: hooks.length ? hooks : skeleton.hooks,
      ctas: ctas.length ? ctas : skeleton.ctas,
      versions,
      updatedAt: Date.now(),
    },
    source: "llm",
    provider: result.provider,
    model: result.model ?? null,
    confidence: clamp01(parsed.confidence, 0.6) * (ctx.missing.length ? 0.8 : 1),
    reasoning: parsed.reasoning?.trim()
      || (parsed.talkingPoints?.length ? `Talking points: ${parsed.talkingPoints.slice(0, 3).join("; ")}` : "Scripted from the brief and this workspace's market context."),
    degradedReason: ctx.missing.length ? `Written without: ${ctx.missing.join(", ")}. Confidence is reduced accordingly.` : undefined,
  };
}
