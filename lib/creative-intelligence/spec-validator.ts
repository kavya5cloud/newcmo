import type { GenerationSpecification, SpecIssue, SpecValidation } from "./types";

// Spec Validator (Part 8) — before a specification is allowed near a provider it must be
// complete. Incomplete specs are rejected. Deterministic, pure.

export function validateSpecification(spec: GenerationSpecification): SpecValidation {
  const errors: SpecIssue[] = [];
  const warnings: SpecIssue[] = [];
  const err = (field: string, message: string) => errors.push({ field, severity: "error", message });
  const warn = (field: string, message: string) => warnings.push({ field, severity: "warning", message });

  // ---- Missing required fields ----
  if (!spec.id) err("id", "specification id is required");
  if (!spec.assetType) err("assetType", "assetType is required");
  if (!spec.audience) err("audience", "audience is required");
  if (!spec.goal) warn("goal", "no goal set — asset may drift from the mission");
  if (!spec.channel) err("channel", "channel is required");
  if (!spec.providerRequirements?.modality) err("providerRequirements.modality", "modality is required to route to a provider");

  // ---- Brand rules ----
  if (!spec.brandRules) err("brandRules", "brand rules are required");
  else {
    if (!spec.brandRules.voice) warn("brandRules.voice", "no brand voice defined");
    if (spec.brandRules.palette.length === 0) warn("brandRules.palette", "no palette defined");
  }

  // ---- Visual completeness ----
  if (!spec.visualDirection) err("visualDirection", "visual plan is required");
  else {
    if (!spec.visualDirection.composition) err("visualDirection.composition", "composition is required");
    if (spec.visualDirection.colorPalette.length === 0) err("visualDirection.colorPalette", "color palette is required");
  }

  // ---- Story / script completeness for timeline modalities ----
  const isTimeline = spec.providerRequirements?.modality === "video" || spec.providerRequirements?.modality === "motion";
  if (isTimeline) {
    if (!spec.storyStructure) err("storyStructure", "video/motion specs require a story structure");
    else {
      if (spec.storyStructure.acts.length === 0) err("storyStructure.acts", "story has no acts");
      const scenes = spec.storyStructure.acts.flatMap((a) => a.scenes);
      if (scenes.length === 0) err("storyStructure.scenes", "story has no scenes");
      if (spec.storyStructure.totalDurationSec <= 0) err("storyStructure.duration", "story duration must be positive");
    }
    if (!spec.script) warn("script", "no script attached — provider will have no dialogue/timing");
    else if (spec.script.sections.length === 0) err("script.sections", "script has no sections");
  }

  // ---- Character references ----
  for (const ref of spec.characterReferences) {
    if (!ref || typeof ref !== "string") err("characterReferences", `invalid character reference: ${String(ref)}`);
  }

  // ---- Asset references / dependencies ----
  for (const dep of spec.assetDependencies) {
    if (!dep || typeof dep !== "string") err("assetDependencies", `invalid asset dependency: ${String(dep)}`);
  }

  // ---- Approval / quality sanity ----
  if (spec.qualityRequirements?.requireProof && !spec.brandRules) {
    warn("qualityRequirements.requireProof", "proof required but no brand rules to check against");
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Convenience guard used by the contract adapter: throws with the first error. */
export function assertValidSpecification(spec: GenerationSpecification): void {
  const v = validateSpecification(spec);
  if (!v.ok) {
    throw new Error(`invalid GenerationSpecification: ${v.errors.map((e) => `${e.field} — ${e.message}`).join("; ")}`);
  }
}
