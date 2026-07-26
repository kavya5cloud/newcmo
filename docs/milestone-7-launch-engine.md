# Milestone 7 — Launch Engine

Populr no longer creates assets — it **orchestrates complete launches**. The founder
thinks "I'm launching my AI product," and the Launch Engine builds the whole strategy:
campaigns, briefs, asset plans, a week-by-week timeline, a dependency graph, a publishing
pipeline, experiments, KPIs and risks. Everything composes the existing engines — no
duplicated business logic, no provider-specific code.

```
Mission + Business Graph + Goals + Budget + Timeline + Audience
        │
        ▼
   Launch Engine  ── template ──▶ Campaigns (goal) ──▶ Asset Planner ──▶ Asset Plans
        │                                   └──▶ Creative Brief
        ▼
   LaunchPlan: objectives · timeline · dependencies · publishing schedule · KPIs ·
               experiments · risks · smart recommendations
```

Everything is deterministic: the same input yields an identical `LaunchPlan` (stable id
hashed from the input).

## Part 1 — Launch Engine (`lib/launch/engine.ts`)

`createLaunch(input) → LaunchPlan`. Picks the template, builds each campaign with a
specialized Creative Brief and a full asset plan (via the **existing** Asset Planner),
allocates budget by priority, then assembles the timeline, dependencies, publishing
schedule, seeded experiments and a deterministic risk assessment.

## Part 2 — Launch Templates (`lib/launch/templates.ts`)

11 reusable blueprints — Product, Feature, Startup, Mobile App, SaaS, AI Tool, Event,
Course, Ecommerce, Newsletter, Podcast. A template names its campaigns (each a real
`CAMPAIGN_GOALS` goal, so the Asset Planner produces the right assets), objectives, KPIs
and experiments. Templates hold **no** asset logic; they compose the planners.

## Part 3 — Campaign Timeline (`lib/launch/timeline.ts`)

`buildTimeline(campaigns, days)` spreads every planned asset across the launch weeks by
its stage (foundation → week 1 … conversion → final week), so a launch reads as
"Week 1: Landing Page, Hero Video, Blog … Week 4: Case Study, Performance Review."

## Part 4 — Dependencies (`lib/launch/dependencies.ts`)

`buildDependencyGraph(campaigns)` merges the Asset Planner's intra-campaign dependencies
with launch-level cross-asset rules (Hero Video → Ads → Shorts → UGC …). Cycle-safe
depths. **`flagDependents(graph, key)`** returns every downstream asset that must be
revisited when an upstream asset changes.

## Part 5 — Publishing Pipeline (`lib/launch/publishing.ts`)

A pure state machine: **Draft → Creative Review → Approval → Scheduled → Publishing →
Published → Measured → Archived**, mirroring the Asset Graph lifecycle. `PublishingQueue`
supports **retry** (the publish step can fail), **rollback**, **bulk** and `advanceAll`,
with full transition history. Deterministic (injectable clock).

## Part 6 — Experiment Engine (`lib/launch/experiments.ts`)

A/B headlines/hooks, thumbnail, CTA, caption and creative-variant tests. Each stores
hypothesis, variants, winner, confidence and performance. `decideWinner` is deterministic:
winner = highest metric; confidence = normalized margin over the runner-up.

## Part 7 & 8 — Launch Workspace + Relationship graph (`app/studio/launch`)

The Launch Workspace renders one `LaunchPlan` across eight sections — Mission, Campaigns,
Timeline, Assets, Dependencies, Publishing, Experiments, Performance — plus smart
recommendations and a relationship graph (Mission → Campaign → Brief → assets) so users
see where every asset originated. Deterministic server render, responsive, dark theme.

## Part 9 — Smart Recommendations (`lib/launch/recommendations.ts`)

`analyzeLaunch(plan, signals?)` proactively surfaces **missing assets, weak campaigns,
missed channels, publishing delays, low-confidence assets and experiment opportunities** —
each **evidence-backed** (cites concrete plan facts) and severity-ranked.

## Part 10 — APIs

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/api/launch/create` | Mission → full LaunchPlan (+ recommendations), persisted. |
| POST | `/api/launch/update` | In-place edits (mission, objectives, re-time). |
| GET | `/api/launch/timeline` | Week-by-week view. |
| POST | `/api/launch/publish` | Drive assets through the pipeline (advance/retry/rollback/bulk). |
| GET / POST | `/api/launch/experiments` | List experiments / record results + decide winner. |
| GET | `/api/launch/dependencies` | Dependency graph; `?changed=` flags downstream. |

## Part 11 — Tests

`launch-engine`, `launch-timeline-deps`, `launch-publishing`, `launch-experiments-recs` —
engine completeness + determinism across all 11 templates, timeline placement, dependency
flagging, publishing state machine (retry/rollback/bulk), experiment winner selection, and
evidence-backed recommendations. All deterministic.

## Schema

`db/migrations/20260721_milestone_7.sql` adds `launches` (one row per plan, plan JSON,
workspace-scoped). Repository pattern: `InMemoryLaunchRepo` + `NeonLaunchRepo`.

## Integration & guarantees

- Composes the **Business Graph, Decision Planner, Mission/Campaign engines, Creative
  Brief, Creative Director and Asset Graph** — no duplicated logic.
- **Provider-agnostic**: the Launch Engine never touches a generation provider; producing
  assets is the Content Studio's job (Milestone 6), which is itself vendor-neutral.
- Deterministic throughout; additive (no existing route/schema/behavior changed).

---

## Launch Workspace — execution layer

The plan the Launch Engine produces is deterministic and it stays that way. What a founder
*does* to a plan — mark an asset done, pause an item, edit the mission, let Populr schedule
unattended — is execution state, and it lives in a separate overlay so the plan can always be
recomputed without losing progress.

| File | Responsibility |
| ---- | -------------- |
| `lib/launch/workspace.ts` | `WorkspaceState` (item statuses, automation, mission edits), pure transitions, derived `campaignProgress` / `workspaceSummary` / `effectiveMission` |
| `lib/launch/workspace-store.ts` | `InMemoryWorkspaceStateRepo` + `NeonWorkspaceStateRepo` (`launch_workspace_state`) |
| `lib/launch/command.ts` | Deterministic command-bar parsing → intent + params |
| `lib/launch/shared.ts` | Process-wide state repo + `resolvePlan` (persisted launch, else the deterministic default) |

**Transitions never mutate.** Every action returns a new state, so the UI can apply a server
response wholesale without reconciling. `reset` deletes the override rather than writing a
"todo" — absence is the default, and storing it would be a lie about intent.

**The command bar is not an LLM call.** It drives real side effects (scheduling, generation,
research), so it parses deterministically and reports `unknown` with examples rather than
guessing. `POST /api/launch/command { preview: true }` returns the parse without executing.

**Automation defaults are conservative.** `approvalWorkflow` on, `campaignExecution` off:
Populr does not run someone's launch until they ask it to.

**Degradation is visible.** If plan storage hiccups, `resolvePlan` falls back to the
deterministic plan and logs it; if execution state can't be read, `GET /api/launch/workspace`
returns `degraded: true` and the dashboard says so — nobody should mistake a storage outage
for "nothing done yet". Writes never pretend: a failed save returns 503.

### Wiring, not duplication

The workspace is a cockpit over services that already exist:

- Publishing → `/api/social/dashboard`, `/api/social/retry`, `/api/social/drafts` (M12)
- Market intelligence → `/api/market/research` (M13), with "add to campaign" creating a draft
- Performance → `/api/learning/dashboard` (M10)
- Generation → `/api/content/generate` (M6)
- Recommendations → `analyzeLaunch`, shown only on the campaign whose evidence cites it

### APIs

`GET /api/launch/workspace` · `POST /api/launch/workspace` (`op`: `item` | `bulkItems` |
`automation` | `mission`) · `POST /api/launch/command`.

### Entry point

The home page closes with a Launch Workspace section linking to the existing
`/studio/launch`. No new route, no second workspace.

### Database

`db/migrations/20260729_launch_workspace_state.sql`.

### Tests

`tests/launch-workspace.test.ts` — 17 tests: immutability, reset semantics, campaign
completion and next-publish derivation, automation defaults, mission layering, store
scoping, and command parsing (horizons, platform ids, determinism, honest `unknown`).
