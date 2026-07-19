// Creative Intelligence Layer — the types for the "thinking" that turns a Creative Brief
// into a validated GenerationSpecification. Providers never see business context; they
// only ever receive a normalized spec derived from these objects.
//
// Pure types only (UI- and I/O-free) so every engine that produces them stays
// deterministic and trivially testable.

import type { AssetKind, CreativeChannel } from "@/lib/creative/taxonomy";
import type { CreativeBriefInput } from "@/lib/creative/types";

// ---------------------------------------------------------------------------
// Story Engine
// ---------------------------------------------------------------------------

export type SceneEmotion =
  | "curiosity" | "tension" | "relief" | "confidence" | "delight" | "trust" | "urgency" | "aspiration";

export type CameraDirection =
  | "static" | "slow_push" | "slow_pull" | "pan" | "handheld" | "orbit" | "top_down" | "close_up" | "wide";

export type SceneTransition = "cut" | "fade" | "dissolve" | "wipe" | "match_cut" | "none";

export type Shot = {
  id: string;
  description: string;
  camera: CameraDirection;
  durationSec: number;
  visualObjective: string;
};

export type Scene = {
  id: string;
  purpose: string;
  emotion: SceneEmotion;
  durationSec: number;
  camera: CameraDirection;
  visualObjective: string;
  transition: SceneTransition;
  shots: Shot[];
  dialogue?: string;
  voiceover?: string;
  visualNotes: string;
  motionNotes: string;
};

export type Act = {
  id: string;
  name: string;      // e.g. "Setup", "Conflict", "Resolution"
  purpose: string;
  scenes: Scene[];
};

/** The story kinds the Story Engine knows how to structure. */
export type StoryFormat =
  | "launch_video" | "product_demo" | "explainer" | "ugc" | "ad" | "tutorial" | "short_form";

export type Story = {
  id: string;
  format: StoryFormat;
  logline: string;
  acts: Act[];
  totalDurationSec: number;
  cta: string;
};

// ---------------------------------------------------------------------------
// Visual Planner
// ---------------------------------------------------------------------------

export type VisualPlan = {
  composition: string;
  camera: string;
  colorPalette: string[];      // hex values, deterministic from brand/emotion
  lighting: string;
  depth: string;
  framing: string;
  typography: string;
  animationStyle: string;
  illustrationStyle: string;
  motionStyle: string;
  referenceAssets: string[];   // asset ids / memory refs, never vendor urls
  mood: string;
};

// ---------------------------------------------------------------------------
// Hook Engine
// ---------------------------------------------------------------------------

export const HOOK_CATEGORIES = [
  "curiosity", "problem", "contrarian", "story", "educational", "shock", "statistics", "pain_point", "benefits",
] as const;
export type HookCategory = (typeof HOOK_CATEGORIES)[number];

export type Hook = {
  id: string;
  category: HookCategory;
  /** Templated line with {audience}/{product}/{pain}/{metric} slots. */
  template: string;
  emotion: SceneEmotion;
  industries: string[];
  audiences: string[];
  channels: CreativeChannel[];
  /** 0..1 measured performance and confidence; history is append-only usage. */
  performance: number;
  confidence: number;
  history: { usedFor?: string; outcome?: string; at?: string }[];
};

// ---------------------------------------------------------------------------
// Script Engine
// ---------------------------------------------------------------------------

export type ScriptSection = {
  label: "hook" | "opening" | "middle" | "cta" | "closing";
  text: string;
  /** seconds from start this section begins. */
  startSec: number;
  durationSec: number;
  sceneRef?: string;    // Scene id this maps to
  voiceNote?: string;
  caption?: string;
};

export type Script = {
  id: string;
  format: StoryFormat;
  sections: ScriptSection[];
  captions: string[];
  voiceNotes: string[];
  totalDurationSec: number;
};

// ---------------------------------------------------------------------------
// Character Engine
// ---------------------------------------------------------------------------

export type Character = {
  id: string;
  name: string;
  identity: string;          // who they are (role, backstory beat)
  appearance: string;
  voice: string;             // abstract voice descriptor, never a vendor voice id
  expressions: string[];
  brand: string;             // how they embody the brand
  style: string;
  avatar?: string;           // reference asset id
  referenceImages: string[]; // asset ids
  voiceReference?: string;   // asset id
  movementStyle: string;
  workspaceKey?: string;
  version: number;
};

// ---------------------------------------------------------------------------
// Creative Memory
// ---------------------------------------------------------------------------

export const MEMORY_KINDS = [
  "hook", "cta", "story_structure", "color", "layout", "character", "video_style", "motion_pattern", "headline", "opening",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type CreativeMemoryEntry = {
  id: string;
  kind: MemoryKind;
  label: string;
  value: string;              // the winning pattern (text/hex/structure descriptor)
  /** 0..1 how well it performed; drives retrieval ranking. */
  performance: number;
  channels: CreativeChannel[];
  audiences: string[];
  tags: string[];
  version: number;
  updatedAt?: string;
};

// ---------------------------------------------------------------------------
// Generation Specification (Part 1) — the ONLY object providers understand
// ---------------------------------------------------------------------------

export type Persona = {
  name: string;
  audience: string;
  motivations: string[];
  objections: string[];
};

export type BrandRules = {
  voice: string;
  doList: string[];
  dontList: string[];
  palette: string[];
  bannedClaims: string[];
};

export type ProviderRequirements = {
  modality: string;          // maps to content-layer Modality; kept as string to avoid a hard dep
  aspectRatio?: string;
  durationSec?: number;
  count?: number;
  minQuality?: number;       // 0..1 quality tier the registry must meet
  maxCredits?: number;
};

export type QualityRequirements = {
  minBrandScore: number;     // 0..1
  minReadability?: number;
  requireProof: boolean;
};

export type ApprovalRequirements = {
  requiresCouncil: boolean;
  minVerdict: "APPROVED" | "REVISION_REQUIRED";
  reviewers?: string[];
};

/**
 * The first-class GenerationSpecification. Every generated asset originates from one.
 * It carries the full creative intelligence (story, visual plan, hook, script,
 * character refs, brand rules and requirements) — never a raw prompt as the interface.
 */
export type GenerationSpecification = {
  id: string;
  assetType: AssetKind;

  // Lineage into the existing pipeline (ids only — providers never get the objects).
  missionId: string | null;
  campaignId: string | null;
  creativeBriefId: string | null;

  goal: string;
  audience: string;
  persona: Persona;
  platform: string;
  channel: CreativeChannel;
  format: StoryFormat | string;
  tone: string;
  emotion: SceneEmotion;

  brandRules: BrandRules;
  visualDirection: VisualPlan;
  storyStructure: Story | null;
  script: Script | null;
  hook: Hook | null;

  references: string[];           // memory/reference asset ids
  assetDependencies: string[];    // asset ids this derives from
  characterReferences: string[];  // Character ids

  providerRequirements: ProviderRequirements;
  qualityRequirements: QualityRequirements;
  approvalRequirements: ApprovalRequirements;

  constraints: string[];
  metadata: Record<string, unknown>;
  version: number;
};

// ---------------------------------------------------------------------------
// Spec validation (Part 8)
// ---------------------------------------------------------------------------

export type SpecIssue = { field: string; severity: "error" | "warning"; message: string };
export type SpecValidation = { ok: boolean; errors: SpecIssue[]; warnings: SpecIssue[] };

// ---------------------------------------------------------------------------
// Asset lineage (Part 10)
// ---------------------------------------------------------------------------

export type AssetLineage = {
  assetId: string;
  specification: GenerationSpecification;
  storyId: string | null;
  visualPlan: VisualPlan | null;
  hookId: string | null;
  scriptId: string | null;
  provider: string | null;
  modelVersion: string | null;
  cost: number | null;
  latencyMs: number | null;
  approval: string | null;
  performance: number | null;
  createdAt?: string;
};

/** The inputs the Creative Intelligence layer reasons over to build a specification. */
export type IntelligenceInput = {
  assetType: AssetKind;
  brief: CreativeBriefInput;
  missionId?: string | null;
  campaignId?: string | null;
  creativeBriefId?: string | null;
  goal?: string;
  platform?: string;
  channel?: CreativeChannel;
  /** Optional business/industry hints for hook + persona resolution. */
  industry?: string;
  /** Asset ids this asset derives from (Asset Graph edges). */
  assetDependencies?: string[];
  characterReferences?: string[];
  constraints?: string[];
};
