// Creative Intelligence Layer — the brain that turns a Creative Brief into a validated
// GenerationSpecification. Providers are renderers; Populr owns the thinking.
//
//   Creative Brief → Creative Intelligence → GenerationSpecification → (validate) → Provider

export * from "./types";
export { buildStory, storyFormatForKind } from "./story-engine";
export { planVisuals } from "./visual-planner";
export { HOOK_LIBRARY, retrieveHooks, selectHook, renderHook, type HookQuery } from "./hook-engine";
export { buildScript, type ScriptOptions } from "./script-engine";
export { buildCharacter, InMemoryCharacterStore, NeonCharacterStore, type CharacterStore } from "./characters";
export {
  memoryEntry, MEMORY_SEED, searchMemory, InMemoryCreativeMemoryStore, NeonCreativeMemoryStore,
  type CreativeMemoryStore, type MemoryQuery,
} from "./creative-memory";
export { buildSpecification, modalityForKind, resolveEmotion } from "./spec-builder";
export { validateSpecification, assertValidSpecification } from "./spec-validator";
export { toProviderSpec } from "./contract";
export { lineageFrom, specForRegeneration, InMemoryLineageStore, NeonLineageStore, type LineageStore } from "./lineage";
