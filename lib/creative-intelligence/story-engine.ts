import type { AssetKind } from "@/lib/creative/taxonomy";
import type { CreativeBriefInput } from "@/lib/creative/types";
import type { Act, CameraDirection, Scene, SceneEmotion, Shot, Story, StoryFormat } from "./types";
import { idFrom, keyPhrase } from "./util";

// Story Engine — converts a Creative Brief into a structured, deterministic story:
// Acts → Scenes → Shots → Dialogue → Voiceover → Visual/Motion notes → CTA.
// No LLM: the beat structure is a pure function of the asset format + brief.

/** Which story format a given asset kind maps to. */
export function storyFormatForKind(kind: AssetKind): StoryFormat {
  switch (kind) {
    case "hero_video": return "launch_video";
    case "product_demo": return "product_demo";
    case "motion_graphic": return "explainer";
    case "ugc_video": return "ugc";
    case "advertisement": return "ad";
    default: return "short_form";
  }
}

// A beat = one scene's blueprint. Each format is an ordered list of beats grouped by act.
type Beat = {
  act: string;
  purpose: string;
  emotion: SceneEmotion;
  durationSec: number;
  camera: CameraDirection;
  visualObjective: string;
  hasVoiceover?: boolean;
  hasDialogue?: boolean;
};

const FORMAT_BEATS: Record<StoryFormat, Beat[]> = {
  launch_video: [
    { act: "Setup", purpose: "Grab attention with the tension the audience feels", emotion: "curiosity", durationSec: 4, camera: "slow_push", visualObjective: "Establish the world before the product", hasVoiceover: true },
    { act: "Setup", purpose: "Name the problem concretely", emotion: "tension", durationSec: 5, camera: "handheld", visualObjective: "Show the pain in a relatable moment", hasVoiceover: true },
    { act: "Conflict", purpose: "Introduce the product as the turn", emotion: "confidence", durationSec: 6, camera: "orbit", visualObjective: "Reveal the product hero shot", hasVoiceover: true },
    { act: "Conflict", purpose: "Demonstrate the core capability", emotion: "delight", durationSec: 7, camera: "close_up", visualObjective: "Show the product doing the key thing", hasVoiceover: true },
    { act: "Resolution", purpose: "Show the after-state / outcome", emotion: "aspiration", durationSec: 5, camera: "wide", visualObjective: "Paint the transformed outcome", hasVoiceover: true },
    { act: "Resolution", purpose: "Drive the call to action", emotion: "urgency", durationSec: 3, camera: "static", visualObjective: "End card with CTA", hasVoiceover: true },
  ],
  product_demo: [
    { act: "Setup", purpose: "State what the viewer will learn to do", emotion: "curiosity", durationSec: 4, camera: "static", visualObjective: "Title + context", hasVoiceover: true },
    { act: "Walkthrough", purpose: "Show step one", emotion: "confidence", durationSec: 8, camera: "top_down", visualObjective: "Screen capture of the first action", hasVoiceover: true },
    { act: "Walkthrough", purpose: "Show the payoff step", emotion: "delight", durationSec: 8, camera: "close_up", visualObjective: "Capture the result appearing", hasVoiceover: true },
    { act: "Close", purpose: "Recap and CTA", emotion: "trust", durationSec: 4, camera: "static", visualObjective: "Summary + CTA", hasVoiceover: true },
  ],
  explainer: [
    { act: "Setup", purpose: "Pose the question", emotion: "curiosity", durationSec: 3, camera: "static", visualObjective: "Kinetic type poses the question" },
    { act: "Body", purpose: "Explain the mechanism simply", emotion: "confidence", durationSec: 6, camera: "pan", visualObjective: "Animated diagram of how it works" },
    { act: "Body", purpose: "Show the benefit", emotion: "delight", durationSec: 5, camera: "static", visualObjective: "Before/after motion comparison" },
    { act: "Close", purpose: "CTA", emotion: "urgency", durationSec: 2, camera: "static", visualObjective: "Logo + CTA end card" },
  ],
  ugc: [
    { act: "Hook", purpose: "Stop the scroll with a personal opener", emotion: "curiosity", durationSec: 3, camera: "handheld", visualObjective: "Creator talking head, direct address", hasDialogue: true },
    { act: "Story", purpose: "Share the relatable problem", emotion: "tension", durationSec: 6, camera: "handheld", visualObjective: "Creator shows the pain in their life", hasDialogue: true },
    { act: "Story", purpose: "Introduce the product naturally", emotion: "delight", durationSec: 7, camera: "close_up", visualObjective: "Hands-on product moment", hasDialogue: true },
    { act: "Payoff", purpose: "Show the result + recommend", emotion: "trust", durationSec: 5, camera: "handheld", visualObjective: "Creator endorses to camera", hasDialogue: true },
  ],
  ad: [
    { act: "Hook", purpose: "Interrupt with the sharpest pain or promise", emotion: "urgency", durationSec: 3, camera: "close_up", visualObjective: "Bold hook visual", hasVoiceover: true },
    { act: "Value", purpose: "One clear benefit", emotion: "confidence", durationSec: 5, camera: "static", visualObjective: "Product + benefit overlay", hasVoiceover: true },
    { act: "CTA", purpose: "Direct response CTA", emotion: "urgency", durationSec: 2, camera: "static", visualObjective: "CTA end card", hasVoiceover: true },
  ],
  tutorial: [
    { act: "Intro", purpose: "Promise the outcome", emotion: "curiosity", durationSec: 4, camera: "static", visualObjective: "Outcome preview", hasVoiceover: true },
    { act: "Steps", purpose: "Teach the steps", emotion: "confidence", durationSec: 12, camera: "top_down", visualObjective: "Step-by-step capture", hasVoiceover: true },
    { act: "Close", purpose: "Recap + CTA", emotion: "trust", durationSec: 4, camera: "static", visualObjective: "Recap card", hasVoiceover: true },
  ],
  short_form: [
    { act: "Hook", purpose: "Deliver the hook in the first second", emotion: "curiosity", durationSec: 2, camera: "close_up", visualObjective: "High-contrast hook frame", hasVoiceover: true },
    { act: "Point", purpose: "Make one point", emotion: "confidence", durationSec: 5, camera: "handheld", visualObjective: "Single idea, visualized", hasVoiceover: true },
    { act: "CTA", purpose: "Fast CTA", emotion: "urgency", durationSec: 2, camera: "static", visualObjective: "CTA card", hasVoiceover: true },
  ],
};

const TRANSITIONS = ["cut", "fade", "dissolve", "match_cut", "cut"] as const;

function shotsFor(scene: { id: string; visualObjective: string; camera: CameraDirection; durationSec: number }): Shot[] {
  // Two shots per scene: an establishing beat and a detail beat, split from the duration.
  const a = Math.max(1, Math.round(scene.durationSec * 0.6));
  const b = Math.max(1, scene.durationSec - a);
  return [
    { id: scene.id + "_s1", description: `Establishing: ${scene.visualObjective}`, camera: scene.camera, durationSec: a, visualObjective: scene.visualObjective },
    { id: scene.id + "_s2", description: `Detail beat reinforcing: ${scene.visualObjective}`, camera: "close_up", durationSec: b, visualObjective: scene.visualObjective },
  ];
}

/** Build a deterministic Story from a brief for a given asset kind. */
export function buildStory(brief: CreativeBriefInput, kind: AssetKind): Story {
  const format = storyFormatForKind(kind);
  const beats = FORMAT_BEATS[format];
  const audience = keyPhrase(brief.audience, "your audience");
  const message = keyPhrase(brief.keyMessage, "the core promise");
  const cta = keyPhrase(brief.cta, "get started");

  // Group beats into acts, preserving order.
  const actOrder: string[] = [];
  const actMap = new Map<string, Scene[]>();
  beats.forEach((beat, i) => {
    const sceneId = idFrom("scene", format, i, beat.purpose);
    const scene: Scene = {
      id: sceneId,
      purpose: beat.purpose,
      emotion: beat.emotion,
      durationSec: beat.durationSec,
      camera: beat.camera,
      visualObjective: beat.visualObjective,
      transition: TRANSITIONS[i % TRANSITIONS.length],
      shots: shotsFor({ id: sceneId, visualObjective: beat.visualObjective, camera: beat.camera, durationSec: beat.durationSec }),
      visualNotes: `${beat.visualObjective}. Keep it on-brand for ${audience}.`,
      motionNotes: `${beat.camera.replace(/_/g, " ")} camera; ${beat.emotion} pacing.`,
      ...(beat.hasVoiceover ? { voiceover: `${beat.purpose} — anchored on "${message}".` } : {}),
      ...(beat.hasDialogue ? { dialogue: `${beat.purpose} (spoken naturally to camera).` } : {}),
    };
    if (!actMap.has(beat.act)) { actMap.set(beat.act, []); actOrder.push(beat.act); }
    actMap.get(beat.act)!.push(scene);
  });

  const acts: Act[] = actOrder.map((name, i) => ({
    id: idFrom("act", format, i, name),
    name,
    purpose: `${name} act`,
    scenes: actMap.get(name)!,
  }));

  const totalDurationSec = beats.reduce((n, b) => n + b.durationSec, 0);
  return {
    id: idFrom("story", format, brief.keyMessage, brief.audience, kind),
    format,
    logline: `For ${audience}: ${message}.`,
    acts,
    totalDurationSec,
    cta,
  };
}
