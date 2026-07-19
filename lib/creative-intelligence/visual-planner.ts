import type { AssetKind } from "@/lib/creative/taxonomy";
import { ASSET_KIND_META } from "@/lib/creative/taxonomy";
import type { CreativeBriefInput } from "@/lib/creative/types";
import type { SceneEmotion, VisualPlan } from "./types";
import { pick, words } from "./util";

// Visual Planner — deterministic art direction from a brief. Every output is a pure
// function of the brief + asset kind + emotion, so the same brief always yields the
// same visual plan.

// Emotion → palette (brand green anchored, with an emotion-driven secondary).
const BASE = "#d5ff72"; // brand accent
const PALETTES: Record<SceneEmotion, string[]> = {
  curiosity:  [BASE, "#40d4c5", "#0f1614", "#fbfdf9"],
  tension:    [BASE, "#f28d78", "#0b0f0e", "#fbfdf9"],
  relief:     [BASE, "#8fe3c0", "#101412", "#fbfdf9"],
  confidence: [BASE, "#7fb8ff", "#0d1412", "#fbfdf9"],
  delight:    [BASE, "#f2bf70", "#111614", "#fbfdf9"],
  trust:      [BASE, "#a9d8ff", "#0e1311", "#fbfdf9"],
  urgency:    [BASE, "#f26d78", "#0b0e0d", "#fbfdf9"],
  aspiration: [BASE, "#c9a9ff", "#101413", "#fbfdf9"],
};

const COMPOSITIONS = ["rule-of-thirds, product left-weighted", "centered hero with negative space", "diagonal lead-in, subject lower-third", "symmetrical, product dead-center"] as const;
const LIGHTING = ["soft key with rim light", "high-key even wash", "dramatic single-source with falloff", "natural window light"] as const;
const FRAMING = ["tight, subject fills 70%", "medium with breathing room", "wide establishing"] as const;
const MOTION = ["subtle parallax + ease-in-out", "kinetic type, snappy cuts", "slow cinematic drift", "motivated camera + smooth cuts"] as const;

function toneToTypography(visualDirection: string): string {
  const w = new Set(words(visualDirection));
  if (w.has("clean") || w.has("minimal")) return "geometric sans, generous tracking, few weights";
  if (w.has("bold") || w.has("loud")) return "heavy grotesk display, tight tracking";
  if (w.has("editorial") || w.has("premium")) return "high-contrast serif display + sans body";
  return "modern sans, medium weight, clear hierarchy";
}

/** Build a deterministic VisualPlan for an asset. */
export function planVisuals(brief: CreativeBriefInput, kind: AssetKind, emotion: SceneEmotion = "confidence"): VisualPlan {
  const meta = ASSET_KIND_META[kind];
  const seed = `${kind}|${brief.visualDirection}|${brief.emotionalAngle}`;
  const isMotion = meta.channel === "video";
  const isStill = meta.category === "images";

  return {
    composition: pick(COMPOSITIONS, seed + "comp"),
    camera: isMotion ? "cinematic, motivated moves only" : "n/a (still)",
    colorPalette: PALETTES[emotion] ?? PALETTES.confidence,
    lighting: pick(LIGHTING, seed + "light"),
    depth: isStill ? "shallow depth of field, subject isolated" : "layered foreground/midground/background",
    framing: pick(FRAMING, seed + "frame"),
    typography: toneToTypography(brief.visualDirection),
    animationStyle: isMotion ? "restrained, purposeful, brand-consistent" : "n/a",
    illustrationStyle: isStill ? "photoreal with subtle brand grade" : "mixed media, minimal",
    motionStyle: isMotion ? pick(MOTION, seed + "motion") : "none (static)",
    referenceAssets: [],
    mood: `${brief.emotionalAngle || "confident"} · ${emotion}`,
  };
}
