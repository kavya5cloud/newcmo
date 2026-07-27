# Milestone 15 — AI Marketing Team

Seven specialists that do the work the Campaign Execution Engine schedules. Strictly
additive: Learning, Job Engine, Publishing, Market Intelligence, Business Graph, Market
Memory, Analytics and the Launch Workspace were not modified.

```
Execution Engine
   │  (decides what runs, and when)
   ▼
Research → Strategy → Content → Creative → Publishing → Analytics → Learning
```

## The rule that shapes everything

**Agents never orchestrate.** They do not call each other, they have no queue, and they
cannot start work. The Execution Engine hands one step to one agent; the agent does that
job through an existing service and reports back. What one agent learns reaches the next
through the Business Graph, Market Memory and the Learning Engine — never a direct call.

This is enforced structurally, not by convention: an agent's only inputs are the
`SharedContext` and its step, and its only output is an `AgentOutcome`. There is no handle
to another agent to call.

## Layout — `lib/agents/`

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | Agent ids, task records, shared context, operator controls |
| `registry.ts` | The roster: responsibilities, the services each works through, which steps it owns, and the reporting chain |
| `context.ts` | **SharedContextAssembler** — one read of the world per step, handed to whichever agent runs |
| `agents.ts` | The seven agents |
| `runner.ts` | **AgentRunner** — the single door between the engine and the team |
| `board.ts` | **AgentBoard** — the dashboard, derived entirely from the task log |
| `store.ts` / `shared.ts` | In-memory + Neon repositories; one process-wide platform |

`lib/execution/agent-services.ts` maps the engine's workflow steps onto the team. It
replaced `lib/execution/services.ts`, which called the same engines directly — the agents
call them now, so keeping both would have been two ways to do one thing.

## Design decisions worth knowing

**One context, not seven fetches.** Every agent for a step receives the same assembled
view. It halves the work and makes it impossible for Content and Publishing to be looking
at different versions of the same campaign. Each source degrades independently; the agent
that needed a dead source says so and drops its confidence.

**Confidence is derived from evidence.** An agent with no market data scores 0.2 and states
that everything downstream rests on the brief alone. A confident number attached to nothing
is worse than no number.

**Agents refuse rather than fake.** Publishing with no connected account fails the step with
the reason instead of queueing work that can never go out. Learning with no published
results records that it learned nothing rather than inventing a pattern that would poison
every future recommendation.

**A paused agent leaves no task record.** Pausing is an operator decision, not a
malfunction, so nothing is written and resuming replays no side effects. The step it owns
stops with the exact sentence needed to continue: *resume it, then retry the step*. (The
engine shows that step as stopped — the wording carries the distinction the M14 state
machine doesn't model.)

**The board is a projection.** No dashboard number is stored. If a count looks wrong, the
task log is the truth and the board is arithmetic over it. Repeated sightings of the same
recommendation collapse to the most confident one.

## Transparency

Every task record carries: current task, reasoning in plain language, confidence,
dependencies, outputs, duration, and any error. The AI Team panel shows all of it.

## APIs

- `GET /api/agents/state` — roster, live status, completed work, approvals, queue,
  recommendations, execution graph (`?campaignId=` to scope)
- `POST /api/agents/control` — `pause | resume | retry | approve | dismiss | require_approval`

Control changes *who may work*; it never starts anything. Only the Execution Engine does.

## Workspace

An **AI team** section inside the existing Launch Workspace — no new page, no new nav. The
execution graph across the top, a card per agent (role, status, current task and reasoning,
confidence, average duration, the services it works through), expandable to responsibilities,
approvals and completed work with full reasoning and outputs.

## Database

`db/migrations/20260731_milestone_15.sql` — `agent_team_state`. The persisted task log is
capped at the most recent 500 tasks so one long launch cannot grow a row without bound.

## Tests

`tests/ai-team.test.ts` — 21 deterministic tests: every non-gate step has exactly one
owner, the dependency chain is acyclic, the transparency trail is complete, a paused agent
leaves no record, approval holds, a thrown agent becomes a failed task rather than a crashed
run, decisions don't mutate the state they're given, and the board's totals agree with the
summaries they came from.
