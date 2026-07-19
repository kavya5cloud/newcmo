import type {
  DocumentSpec, GenerationSpec, ImageSpec, MotionSpec, VideoSpec, VoiceSpec,
} from "@/lib/content/types";
import type { GenerationSpecification } from "./types";
import { assertValidSpecification } from "./spec-validator";

// Generation Contract (Part 9) — the seam that turns a validated GenerationSpecification
// into the normalized, provider-facing GenerationSpec. Providers NEVER receive the
// campaign, brief, business context or a raw prompt as the interface: they receive only
// this normalized spec. The human-readable `prompt` field is a DERIVED rendering of the
// intelligence, not the source of truth.

/** Compose a deterministic instruction from the specification's intelligence. */
function renderInstruction(spec: GenerationSpecification): string {
  const v = spec.visualDirection;
  return [
    `${spec.assetType.replace(/_/g, " ")} for ${spec.audience}.`,
    spec.goal ? `Goal: ${spec.goal}.` : "",
    `Tone: ${spec.tone}; emotion: ${spec.emotion}.`,
    spec.hook ? `Open in the spirit of: "${spec.hook.template}".` : "",
    `Visual: ${v.composition}; ${v.lighting}; ${v.framing}; palette ${v.colorPalette.join("/")}.`,
    spec.storyStructure ? `Narrative: ${spec.storyStructure.logline}` : "",
    `Brand voice: ${spec.brandRules.voice}. Never: ${spec.brandRules.bannedClaims.join(", ")}.`,
  ].filter(Boolean).join(" ");
}

function hintsFrom(spec: GenerationSpecification): Record<string, unknown> {
  return {
    tone: spec.tone,
    emotion: spec.emotion,
    palette: spec.visualDirection.colorPalette,
    mood: spec.visualDirection.mood,
    typography: spec.visualDirection.typography,
    motionStyle: spec.visualDirection.motionStyle,
    brandVoice: spec.brandRules.voice,
    references: spec.references,
  };
}

const DOC_SECTIONS: Record<string, string[]> = {
  blog: ["hook", "context", "body", "proof", "cta"],
  press_release: ["headline", "dateline", "lede", "quote", "boilerplate"],
  sales_deck: ["problem", "solution", "proof", "pricing", "cta"],
  case_study: ["challenge", "approach", "results", "quote"],
  email: ["subject", "hook", "body", "cta"],
};

/**
 * Normalize a validated GenerationSpecification into a provider-facing GenerationSpec.
 * Throws if the specification is invalid — nothing incomplete reaches a provider.
 */
export function toProviderSpec(spec: GenerationSpecification): GenerationSpec {
  assertValidSpecification(spec);

  const prompt = renderInstruction(spec);
  const hints = hintsFrom(spec);
  const base = { kind: spec.assetType, prompt, hints };
  const req = spec.providerRequirements;
  const scriptText = spec.script ? spec.script.sections.map((s) => s.text).join("\n") : "";

  switch (req.modality) {
    case "image": {
      const s: ImageSpec = { ...base, modality: "image", aspectRatio: req.aspectRatio ?? "1:1", count: req.count ?? 1 };
      return s;
    }
    case "video": {
      const s: VideoSpec = {
        ...base, modality: "video",
        durationSec: req.durationSec ?? spec.storyStructure?.totalDurationSec,
        aspectRatio: req.aspectRatio ?? "9:16",
        script: scriptText || undefined,
        scenes: spec.storyStructure?.acts.flatMap((a) => a.scenes).map((sc) => ({ description: sc.visualObjective, durationSec: sc.durationSec })),
      };
      return s;
    }
    case "motion": {
      const s: MotionSpec = {
        ...base, modality: "motion",
        durationSec: req.durationSec ?? spec.storyStructure?.totalDurationSec,
        aspectRatio: req.aspectRatio ?? "16:9",
        storyboard: spec.storyStructure?.acts.flatMap((a) => a.scenes).map((sc) => sc.visualObjective),
      };
      return s;
    }
    case "voice": {
      const s: VoiceSpec = {
        ...base, modality: "voice",
        script: scriptText || prompt,
        voice: undefined,
        durationSec: req.durationSec ?? spec.storyStructure?.totalDurationSec,
      };
      return s;
    }
    case "document":
    default: {
      const s: DocumentSpec = {
        ...base, modality: "document",
        format: String(spec.format || spec.assetType),
        sections: DOC_SECTIONS[spec.assetType] ?? ["hook", "body", "proof", "cta"],
      };
      return s;
    }
  }
}
