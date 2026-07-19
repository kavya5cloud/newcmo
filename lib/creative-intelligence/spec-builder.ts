import { ASSET_KIND_META, type AssetKind } from "@/lib/creative/taxonomy";
import type { CreativeBriefInput } from "@/lib/creative/types";
import type {
  BrandRules, GenerationSpecification, IntelligenceInput, Persona, SceneEmotion,
} from "./types";
import { buildStory, storyFormatForKind } from "./story-engine";
import { planVisuals } from "./visual-planner";
import { buildScript } from "./script-engine";
import { selectHook } from "./hook-engine";
import { idFrom, keyPhrase, words } from "./util";

// Spec Builder — the heart of the Creative Intelligence layer. Composes the story,
// visual plan, hook, script, brand rules, persona and requirements into ONE validated-
// ready GenerationSpecification. This is what replaces "Creative Brief → Provider".

/** Which abstract modality an asset kind renders as (string to avoid a hard content dep). */
export function modalityForKind(kind: AssetKind): string {
  const m = ASSET_KIND_META[kind];
  if (kind === "motion_graphic") return "motion";
  if (m.channel === "video") return "video";
  if (m.category === "images") return "image";
  if (m.category === "documents") return "document";
  if (m.category === "ads") return "image";
  return "document";
}

/** Map the brief's emotional angle onto a concrete scene emotion. Deterministic. */
export function resolveEmotion(brief: CreativeBriefInput): SceneEmotion {
  const w = new Set(words(`${brief.emotionalAngle} ${brief.keyMessage}`));
  if (w.has("urgent") || w.has("now") || w.has("fast")) return "urgency";
  if (w.has("calm") || w.has("confidence") || w.has("confident")) return "confidence";
  if (w.has("trust") || w.has("proven") || w.has("credible")) return "trust";
  if (w.has("delight") || w.has("magic") || w.has("wow")) return "delight";
  if (w.has("aspirational") || w.has("dream") || w.has("future")) return "aspiration";
  if (w.has("curious") || w.has("curiosity") || w.has("secret")) return "curiosity";
  return "confidence";
}

function personaFrom(brief: CreativeBriefInput, industry?: string): Persona {
  const audience = keyPhrase(brief.audience, "founders");
  return {
    name: `${audience} persona`,
    audience,
    motivations: [brief.successMetric || "growth", brief.keyMessage || "results"].filter(Boolean),
    objections: ["no time", "another tool to learn", industry ? `${industry} skepticism` : "unproven"].filter(Boolean),
  };
}

function brandRulesFrom(brief: CreativeBriefInput): BrandRules {
  return {
    voice: brief.emotionalAngle || "confident, clear, no fluff",
    doList: ["lead with the outcome", "sound human", `honor the visual direction: ${brief.visualDirection || "clean"}`],
    dontList: ["no clichés or hype", "no unverified numbers", "no generic AI filler"],
    palette: ["#d5ff72", "#0b0f0e", "#fbfdf9"],
    bannedClaims: ["#1", "guaranteed", "best in the world", "100% results"],
  };
}

/**
 * Build a complete GenerationSpecification from a Creative Brief + intelligence input.
 * Deterministic — the same brief/kind always yields the same specification (by id too).
 */
export function buildSpecification(input: IntelligenceInput): GenerationSpecification {
  const { assetType: kind, brief } = input;
  const meta = ASSET_KIND_META[kind];
  const modality = modalityForKind(kind);
  const emotion = resolveEmotion(brief);
  const isTimeline = modality === "video" || modality === "motion";

  const story = isTimeline ? buildStory(brief, kind) : null;
  const hook = selectHook({ channel: input.channel ?? meta.channel, audience: brief.audience, industry: input.industry });
  const script = isTimeline ? buildScript(brief, kind, { story: story ?? undefined, hook }) : null;
  const visualDirection = planVisuals(brief, kind, emotion);

  return {
    id: idFrom("spec", kind, brief.keyMessage, brief.audience, input.campaignId ?? "", input.missionId ?? ""),
    assetType: kind,
    missionId: input.missionId ?? null,
    campaignId: input.campaignId ?? null,
    creativeBriefId: input.creativeBriefId ?? null,

    goal: input.goal || brief.objective || "",
    audience: keyPhrase(brief.audience, "founders"),
    persona: personaFrom(brief, input.industry),
    platform: input.platform || meta.channel,
    channel: input.channel ?? meta.channel,
    format: story ? story.format : storyFormatForKind(kind),
    tone: brief.emotionalAngle || "confident",
    emotion,

    brandRules: brandRulesFrom(brief),
    visualDirection,
    storyStructure: story,
    script,
    hook,

    references: [],
    assetDependencies: input.assetDependencies ?? [],
    characterReferences: input.characterReferences ?? [],

    providerRequirements: {
      modality,
      aspectRatio: modality === "image" ? "1:1" : isTimeline ? "9:16" : undefined,
      durationSec: story ? story.totalDurationSec : undefined,
      count: 1,
      minQuality: 0.6,
    },
    qualityRequirements: {
      minBrandScore: 0.6,
      minReadability: modality === "document" ? 0.6 : undefined,
      requireProof: !!brief.proof,
    },
    approvalRequirements: {
      requiresCouncil: true,
      minVerdict: "APPROVED",
    },

    constraints: input.constraints ?? [],
    metadata: { builtBy: "creative-intelligence", modality },
    version: 1,
  };
}
