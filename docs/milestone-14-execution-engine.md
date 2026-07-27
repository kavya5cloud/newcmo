# Milestone 14 — AI Campaign Execution Engine

The Launch Workspace stops describing a plan and starts running it. Strictly additive: no
Learning (M10), Job Engine (M11), Publishing (M12), Market Intelligence (M13), Business
Graph or Market Memory code was modified.

```
Mission → Research → Market Intelligence → Campaign Planning → Asset Generation
       → Copy Generation → Platform Optimisation → Approval → Publishing
       → Analytics → Learning → Optimise Remaining Campaign
```

## Layout — `lib/execution/`

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | Workflow steps, 8 step statuses, execution modes, health, activity, notifications, adaptations |
| `state-machine.ts` | **ExecutionStateMachine** — the only place a step's status changes; illegal transitions are rejected |
| `workflow.ts` | **WorkflowCoordinator** — what each step means and which service does it (+ deterministic reference services) |
| `agent-services.ts` | The live wiring — each step is performed by the agent that owns it (M15). The engine still decides what runs. |
| `approval.ts` | **ApprovalCoordinator** — when a run must stop for a human |
| `engine.ts` | **CampaignExecutionEngine** — run / pause / resume / retry / cancel / emergency stop, modes, queue, recurrence |
| `health.ts` | **CampaignHealthService** — continuous health, each status explained with a fix |
| `notifications.ts` | **NotificationService** — derived, content-addressed, dismissible |
| `adaptive.ts` | **AdaptiveTimeline** — market-driven proposals that are never applied automatically |
| `history.ts` | **ExecutionHistory** — the append-only activity stream |
| `store.ts` / `shared.ts` | In-memory + Neon repositories; one process-wide platform |

## The rules that shape this design

**One orchestration layer.** The engine advances steps; it does not queue jobs, retry
publishes or aggregate performance. Those belong to the Job Engine, the Publishing Engine
and the Learning Engine, and `services.ts` is the only file that talks to them.

**Illegal transitions are refused, not coerced.** A completed step cannot re-run and a
cancelled step cannot resume. Publishing is irreversible, so the machine will not let a
race or a double-click put a post out twice.

**Approval mode stops once, not twice.** The approval gate covers the publish it is
gating — stopping again immediately after would train people to click through approvals.

**Health always says why.** Every status carries reasons with concrete evidence and the
fix. An unstarted campaign is *needs attention*, never a confident green.

**Notifications are derived, not emitted.** Same inputs → same content-addressed ids, so
polling never duplicates one and a dismissal sticks. Duplicates collapse on merge, and no
notification promises an action the command bar can't perform.

**Adaptive means proposed.** Trends and competitor moves produce proposals with evidence.
Approving one records the authorisation; nothing rewrites a running launch on its own.

**Recurring campaigns re-arm.** A completed recurring campaign resets and schedules its
next start rather than looping inline.

## APIs

- `GET /api/execution/state` — campaigns, execution views, health, platform status,
  notifications and activity in one payload (`?since=` for incremental feed reads)
- `POST /api/execution/control` — `run | pause | resume | retry | cancel | step |
  emergency_stop | clear_emergency_stop | mode | recurrence | drain`
- `GET|POST /api/execution/notifications` — derive / dismiss
- `GET|POST /api/execution/adaptive` — proposals / decisions

## UI

The Launch Workspace is unchanged in layout. Campaign cards gained live health, current and
next step, estimated completion, recent activity and run controls; two sections were added
(**Execution** — the workflow with per-step actions — and **Activity** — the timestamped
stream); notifications sit in the header with Act / View details / Dismiss. The panel polls
every 6s and stops entirely while the tab is hidden. The only animation is a slow pulse on
running steps, scoped to the execution panels and disabled under `prefers-reduced-motion`.

## Database

`db/migrations/20260730_milestone_14.sql` — `execution_state`, `execution_activity`,
`execution_notifications`, `execution_adaptations`.

## Tests

`tests/campaign-execution.test.ts` — 35 deterministic tests: illegal transitions, attempt
counting, status derivation, the approval gate in all three modes, failure isolation,
targeted retry, pause/resume, emergency stop, queueing, recurrence re-arming, scheduled
holds, the activity trail, honest health, notification determinism and dismissal, adaptive
proposals never self-applying, and a thrown service becoming a failed step rather than a
crash.
