# Milestone 9 — Publishing & Growth Execution Layer

Populr no longer stops after generating assets — it executes complete campaigns.
Platforms are **adapters**; the Business Graph and Asset Graph stay the source of truth.
Additive: no existing system was redesigned, and the Milestone 7 lifecycle, experiment
engine and dependency graph are **reused, not duplicated**.

```
… Approval Council → Publishing Engine → Publishing Providers → Platform APIs
   → Performance Collection → Asset Graph → Learning Engine (next milestone)
```

## Layout — `lib/publishing/`

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | Platforms, `PublishingProvider` interface, `PublishRecord`, `ApprovalRecord`, `ContentPackage`, calendar + event types |
| `providers.ts` | 9 reference platform adapters (LinkedIn/X/Instagram/Facebook/TikTok/YouTube/Email/Website/CMS) + `platformFor()` routing |
| `registry.ts` | Provider registry (register / lookup / health) |
| `events.ts` | `EventBus` — every transition emits a `PublishEvent` (event-driven) |
| `engine.ts` | **Publishing Engine** — event-driven lifecycle wrapping the M7 `PublishingQueue`, with the **approval gate** and **dependency flagging** |
| `router.ts` | **Publishing Router** — provider selection, retries, fallback, rate limiting, status, progress events |
| `calendar.ts` | Marketing calendar (day/week/month/campaign/mission/platform views) + reschedule / duplicate / cancel |
| `approvals.ts` | Approval workflow — individual / bulk / role-based (Creative Director, Marketing Lead, Founder); immutable records |
| `packages.ts` | `ContentPackage` — every Launch Engine output becomes one, carrying Asset Graph lineage |
| `history.ts` | Publishing history repository (in-memory + Neon) |

Reused via the barrel: `PublishingQueue` / `PUBLISH_STAGES` (lifecycle), the experiment
engine (`createExperiment` / `runExperiment` / …), and the dependency graph
(`buildDependencyGraph` / `flagDependents` / `upstreamOf`).

## Guarantees enforced in code

- **Never bypass approval** — `PublishingEngine.advance` blocks `approval → scheduled`
  until `approve()` is called; the `ApprovalWorkflow` role gate requires every required
  role to sign off.
- **Never bypass the Asset Graph** — the engine drives the same lifecycle stages the
  Asset Graph records; packages carry lineage.
- **Event-driven** — every stage transition, retry, rollback, failure and needs-review
  emits a typed event on the bus.
- **Providers are replaceable** — the router only knows the `PublishingProvider`
  interface; adapters drop in without touching business logic.
- **Dependencies respected** — `markUpstreamChanged(key)` rolls every downstream
  dependent back to review and emits `asset.needs_review` (Part 5).

## APIs (`/api/publishing/*`)

`publish`, `schedule`, `calendar`, `status`, `providers`, `packages`, `history`,
`approvals`, `experiments`.

## Marketing Dashboard

`/studio/publishing` — Publishing Queue, Approval Queue, Calendar, Campaign Timeline,
Content Packages, Publishing Status (events), Dependency Viewer, Platform Health,
Upcoming. Every panel is derived from one Launch Engine plan routed through the
publishing layer — nothing mocked.

## Persistence

Migration `db/migrations/20260723_milestone_9.sql` adds `pub_approvals` and `pub_history`.
Engines stay pure/deterministic; only approval + history state is stored. Repository
pattern (in-memory default, Neon in prod).

## Tests

`tests/publishing-engine.test.ts`, `tests/publishing-router.test.ts`,
`tests/publishing-calendar-packages.test.ts` — lifecycle, approval gate, dependency
flagging, retry/rollback, bulk, provider selection, retry+fallback, rate limiting,
calendar views + reschedule/duplicate/cancel, packages + lineage, role-based approvals,
experiments. 19 deterministic tests.
