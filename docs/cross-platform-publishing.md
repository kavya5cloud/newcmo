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

## Webhook Service

`lib/social/webhooks.ts` + `POST /api/social/webhooks/[platform]`.

Platform callbacks (publish confirmed/failed, post deleted, token revoked) arrive here,
are **HMAC-SHA256 verified in constant time** against `SOCIAL_WEBHOOK_SECRET`, then
normalized into one `WebhookEvent` shape — each provider's vocabulary
(`post_published`, `media_published`, `deauthorize`, …) maps in a single alias table, so
platform detail never reaches the engine.

`SocialPublishingEngine.applyWebhook()` applies them: a confirmation finalizes the post, a
failure re-enters the retry/backoff path (never silently lost), a deletion cancels the job,
and **token revocation disconnects the account and drops its credential** so nothing can
publish with a dead token. Requests are rejected with 401 on a bad signature, and the
route fails closed (503) in production when no secret is configured.

## Asset Service

`lib/social/assets.ts` + `/api/social/assets` (GET/POST/DELETE), table `social_assets`.

Media kind is **derived from the MIME type**, never trusted from the client, and unknown
types are rejected with 415. `validateForPlatform()` checks assets against the target
platform's constraints — which come from that platform's **adapter**, so adding a platform
never means editing the asset service. It catches the mistakes that would otherwise only
fail at publish time: Instagram/Pinterest requiring media, X's 4-asset cap, Pinterest
rejecting video, and images missing alt text.

## Dashboard additions

`/studio/social` now also has a **Draft Manager** (list / load / delete, plus “Save draft”
from the composer) and an **Integration Settings** panel (per-account status with
disconnect / reconnect).
