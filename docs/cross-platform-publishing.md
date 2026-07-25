# Cross-Platform Publishing System (Milestone 12)

A modular, production-shaped publishing layer that connects social accounts via OAuth and
publishes — now or scheduled — to **LinkedIn, Instagram Business, Facebook Pages, X,
Threads and Pinterest**. Additive: the existing Publishing Engine (M9) and Connector
Platform (M12 connectors) are untouched.

## Design rules

- **Adapters own all platform specifics.** Each implements exactly `publish` / `schedule`
  / `delete` / `refreshToken` / `validateConnection` (+ `constraints`). Real providers drop
  in with **zero** changes to the scheduler, queue or workers.
- **The scheduler contains no platform logic** — it only decides *when*. Workers execute
  jobs *through adapters only*.
- **Tokens are encrypted at rest** (AES-256-GCM); never stored or logged in plaintext.

## Layout — `lib/social/`

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `SocialAdapter` interface, accounts, drafts, jobs, assets, history, constraints |
| `crypto.ts` | AES-256-GCM token sealing/opening + log masking |
| `oauth.ts` | OAuth service (begin/complete/refresh) + encrypted credential store (in-memory + Neon) |
| `adapters.ts` | 6 reference adapters with per-platform constraints (char limits, media rules, scheduling) |
| `registry.ts` | Adapter registry — the only path to a platform |
| `scheduler.ts` | **Timezone-aware** (`zonedTimeToEpoch`, DST-correct) + exponential backoff + due check |
| `worker.ts` | Executes one job through an adapter; validates + refreshes token first |
| `store.ts` | Accounts / drafts / jobs / history stores (in-memory + Neon) |
| `engine.ts` | Facade: connect/disconnect, drafts CRUD, publish-now, schedule, retry, cancel, dispatch-due, metrics |

## Features

Connect via OAuth · encrypted token storage + refresh · drafts · publish now · scheduled +
timezone-aware · calendar · publish history · retry failed · cancel scheduled · **multiple
assets** · idempotent jobs (same key never publishes twice) · exponential backoff ·
**dead-letter queue** · structured logging · queue metrics/monitoring.

## Lifecycle

`queued → publishing → published` on success; on failure `→ queued` (backoff) up to
`maxRetries`, then `→ dead_letter`. Scheduled jobs sit in `scheduled` until due, then
dispatch. `cancel` and manual `retry` are supported.

## APIs (`/api/social/*`)

`accounts` (GET), `accounts/connect`, `accounts/disconnect`, `publish`, `schedule`,
`retry`, `cancel`, `drafts` (GET/POST), `drafts/{id}` (GET/PATCH/DELETE), `history`,
`dashboard`.

## UI

`/studio/social` — Publishing Dashboard: connected accounts, composer (publish now /
schedule), calendar, queue status (with retry/cancel), publish history.

## Database

Migration `db/migrations/20260727_social_publishing.sql`: `social_accounts`,
`social_credentials` (encrypted), `social_drafts`, `social_jobs`, `social_history`. Set
`SOCIAL_TOKEN_KEY` in production for the encryption key (a dev key is used otherwise).

## Tests

`tests/social-publishing.test.ts` — encryption round-trip, all 6 adapters + constraints,
timezone conversion (UTC + DST), backoff, connect, publish-now, idempotency, schedule +
due dispatch, cancel, retry→dead-letter, drafts CRUD + multiple assets. 12 deterministic
tests.
