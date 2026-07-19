# Milestone 8 — Creative Intelligence Layer

The brain that turns marketing strategy into an executable, validated
**GenerationSpecification**. Providers are renderers; Populr owns the thinking. This
milestone is additive — no existing system or API was changed.

```
Business Graph → Decision Planner → Mission → Campaign → Creative Brief
      → Asset Planner → Creative Intelligence → GenerationSpecification
      → (validate) → Provider Registry → Generation Router → Provider
      → Creative Director → Asset Graph
```

Providers never receive the campaign, the brief, business context, or a raw prompt as
the interface. They receive **only** a normalized, validated spec.

## Layout — `lib/creative-intelligence/`

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `GenerationSpecification` (Part 1) + Story/Scene/VisualPlan/Hook/Script/Character/CreativeMemory/Lineage types |
| `story-engine.ts` | Brief → Story: Acts → Scenes → Shots → Dialogue/Voiceover → Visual/Motion notes → CTA (per format) |
| `visual-planner.ts` | Deterministic composition, camera, palette, lighting, depth, framing, typography, motion, mood |
| `hook-engine.ts` | Seeded, categorized hook library + deterministic retrieval + slot rendering |
| `script-engine.ts` | Typed script sections (hook/opening/middle/cta/closing) with timing, captions, voice notes, scene refs |
| `characters.ts` | Reusable AI presenters / UGC personas — repository (in-memory + Neon) |
| `creative-memory.ts` | Winning patterns (hooks/CTAs/structures/colors/layouts/characters/styles/headlines/openings), searchable + versioned |
| `spec-builder.ts` | Composes everything into one `GenerationSpecification` |
| `spec-validator.ts` | Rejects incomplete specs (brand/missing/deps/character/story/visual/asset checks) |
| `contract.ts` | Normalizes a **validated** spec → provider `GenerationSpec` (the Generation Contract) |
| `lineage.ts` | Per-asset lineage (spec/story/visual/hook/script/provider/model/cost/latency/approval/performance); reuse for regeneration |

Everything is **deterministic**: the same brief + asset kind always yields a byte-identical
specification (ids included), so specs are cacheable and auditable.

## GenerationSpecification (Part 1)

Every generated asset originates from one spec carrying: `id, assetType, missionId,
campaignId, creativeBriefId, goal, audience, persona, platform, channel, format, tone,
emotion, brandRules, visualDirection, storyStructure, script, hook, references,
assetDependencies, characterReferences, providerRequirements, qualityRequirements,
approvalRequirements, constraints, metadata, version`.

## The Generation Contract (Part 9)

`toProviderSpec(spec)` validates first (throws if incomplete), then maps to the existing
vendor-neutral `GenerationSpec` (`lib/content/types.ts`). The provider `prompt` is a
**derived rendering** of the intelligence, never the source of truth. Video/motion specs
carry scenes/storyboard + script; documents carry sections; images carry aspect/count.

## APIs

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/api/spec/build` | Brief → GenerationSpecification (+ validation + provider spec) |
| POST | `/api/spec/validate` | Validate a spec before routing |
| POST | `/api/story` | Brief → structured Story |
| POST | `/api/script` | Brief → typed Script |
| GET | `/api/hooks` | Retrieve reusable hooks (category/channel/audience filters) |
| GET/POST | `/api/characters` | List / create reusable characters |
| GET/POST | `/api/creative-memory` | Search / record winning patterns |

## Persistence

Migration `db/migrations/20260722_milestone_8.sql` adds `ci_characters`,
`ci_creative_memory`, `ci_asset_lineage`. Engines stay pure; only reusable/audit state is
stored. Repository pattern (in-memory default, Neon in prod) keeps tests DB-free.

## Tests

`tests/ci-{story,visual,hooks,script,characters,memory,validation,spec}.test.ts` — 36
deterministic tests covering every engine, the validator, and the contract normalization.
