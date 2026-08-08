# Populr — Engineering Handbook

The one document to read before you touch this codebase. It covers what the product does,
how the code is arranged, how a request actually flows, the patterns you are expected to
follow, and the traps that have already caught people.

Read it end to end once. After that, use the map and the milestone docs.

---

## 1. What Populr is

An AI CMO for early-stage companies. A founder pastes their website; Populr reads it, works
out the positioning, plans what to do, writes the content, publishes it on the founder's
connected accounts, measures what happened, and folds the result into what it does next.

**It is not a chat wrapper.** Most of the intelligence is deterministic code. The model is
used at specific, bounded points — mainly writing prose and a few reasoning summaries — and
every one of those points has a deterministic fallback. If you find yourself about to ask a
model to make a decision that a function could make, you are probably solving it the wrong
way round.

The founder is always in control: nothing publishes without a schedule they created.

---

## 2. What it does — the feature map

| Area | What it does for the founder | Where the code lives |
| --- | --- | --- |
| **Website analysis** | Reads a site (or Instagram/LinkedIn/X/YouTube/Google Business) and derives brand, positioning, audience, voice, competitors | `app/app/_lib/sources.ts`, `/api/generate` |
| **AI CMO chat** | Answers strategy questions grounded in that business, and writes assets on request | `/api/cmo/respond`, `lib/cmo/` |
| **Agent board** | Seven channel agents (SEO, GEO, Reddit, X, LinkedIn, Articles, HN), each showing work to do; rotates every 12 hours | `lib/agent-feed.ts`, `app/app/_lib/feed.ts` |
| **Content Studio** | Generates posts, threads, blogs, emails, landing copy, UGC scripts, hooks, CTAs | `lib/content/`, `lib/ugc/` |
| **Campaigns / Missions** | Multi-asset campaign plans with a dependency graph and timeline | `lib/launch/`, `app/app/campaigns/` |
| **Cross-platform publishing** | OAuth connect, encrypted tokens, per-platform adapters, scheduling, retries, dead-letter | `lib/social/` |
| **Automation** | Recurring schedules that generate and publish on their own | `lib/automation/` |
| **Market intelligence** | Trends, competitors, keywords, opportunities | `lib/market/` |
| **Learning engine** | Pattern library, Brand DNA, decision feedback — what actually worked | `lib/learning/`, `lib/intel.ts` |
| **Job engine** | Background work, queue, worker pool, live progress over SSE | `lib/jobs/` |
| **Execution engine** | Campaign workflow state machine, health, notifications | `lib/execution/` |
| **AI team** | Seven agents that perform workflow steps | `lib/agents/` |
| **Referrals** | Refer 3 people, get 30 extra trial days | `lib/referrals.ts` |
| **Trial & auth** | Email/password + Google, 30-day trial, server-enforced | `lib/auth.ts`, `lib/trial.ts` |
| **SEO** | Sitemap, robots, canonicals, structured data, OG images | `lib/seo.ts`, `app/sitemap.ts` |

Note `lib/flags.ts` — the Content Engine is currently hidden behind a flag and `proxy.ts`
gates its routes. The code is live; the doors are shut.

---

## 3. Stack

- **Next.js 16** (App Router), **React 19**, **TypeScript** strict
- **Neon** serverless Postgres (`@neondatabase/serverless` — HTTP driver, no pool)
- **Plain CSS** — one stylesheet, `app/globals.css`. No Tailwind, no CSS-in-JS
- **Vitest** for tests
- **Vercel** for hosting and cron
- **jose** for JWT sessions, **bcryptjs** for passwords

Eight production dependencies, deliberately. No ORM, no component library, no state library.

Two Next 16 specifics that will bite you:

- Dynamic routes take `ctx: { params: Promise<{ id: string }> }` — params are async now.
- `proxy.ts` replaces the old `middleware.ts`.

---

## 4. Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npx vitest run       # full suite — 758 tests, 69 files
```

```bash
npx tsc --noEmit     # typecheck
```

```bash
npm run build        # production build
```

**It runs with no database and no API keys.** Every store has an in-memory implementation
and every AI path has a deterministic fallback. This is deliberate — see §7.5.

Environment (`.env.local`, never committed — read `.env.example`, which is):

| Variable | For |
| --- | --- |
| `GROQ_API_KEY` | Generation. The one that matters |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional second provider — check your key can reach the model first |
| `DATABASE_URL` | Neon |
| `CRON_SECRET` | Bearer token for `/api/cron/*` |
| `SOCIAL_TOKEN_KEY` | AES-256-GCM key for social tokens. **Set it once and never change it** — see §9 |
| `LINKEDIN_CLIENT_ID` / `_SECRET` | LinkedIn publishing |
| `X_PUBLISH_CLIENT_ID` / `_SECRET` | X publishing. **Not** `X_CLIENT_ID`, which is sign-in-with-X |
| `SOCIAL_REDIRECT_BASE` | OAuth callback origin, exact, no trailing slash |

---

## 5. The shape of the codebase

409 TypeScript files, ~40k lines, 122 API routes.

```
app/
  page.tsx              marketing home
  layout.tsx            root metadata, fonts, JSON-LD
  favicon.ico           + icon.svg + apple-icon.png — Next file conventions, auto-hashed
  app/                  the signed-in dashboard
    page.tsx            the shell + state (the one big component)
    _lib/               dashboard logic, extracted and unit-shaped
      ai.ts             the browser's call into /api/generate
      sources.ts        website / IG / LinkedIn / X / YouTube / GBP entry
      feed.ts           agent board: build fallback, merge saved
      catalog.tsx       AGENTS and DOCS — static definitions
      chart-data.ts     seeded estimates before Search Console is connected
      demo-data.ts      everything shown before real data exists
      telemetry.ts      fire-and-forget recommendation logging
      trial.ts          trial countdown for display
      html.ts           escaping for inline SVG
    _components/        Chart, AuthModal
    campaigns/          missions UI
    assistant/          marketing assistant
  studio/               creative studio (content, launch, publishing, market, learning)
  components/           shared UI — Icon, Section, DocSkeleton, ai-processing/
  api/                  route handlers, one folder per resource
lib/
  services/llm.ts       the ONLY place that calls a model provider
  cmo/                  intent → decision → prompt → answer
  content/  ugc/        generation
  social/               cross-platform publishing
  automation/           recurring schedules
  launch/ execution/    campaigns and their workflow
  agents/               the seven AI agents
  market/ learning/     intelligence and feedback
  jobs/                 background job engine
db/migrations/          plain SQL, applied in filename order (17 files)
tests/                  one file per subsystem (69 files)
docs/                   this file + one per milestone
```

Folders prefixed `_` are not routes — Next ignores them for routing, which is exactly why
dashboard-only modules live in `app/app/_lib` rather than `lib/`.

---

## 6. How a request actually flows

Worth tracing once, because it explains most of the architecture.

### A founder asks the CMO a question

```
app/app/page.tsx  sendChat()
  → POST /api/cmo/respond
      1. routeIntent()        lib/services/intent-router.ts   deterministic, no LLM
      2. assembleCmoContext()  lib/services/cmo-context.ts     business, goals, history
      3. planDecision()       lib/cmo/planner.ts              scores options, no LLM
      4. build a prompt  ─┬─ content   → buildContentPrompt   (deliverable)
                          ├─ edit      → buildEditPrompt      (deliverable)
                          ├─ transform → buildTransformPrompt (deliverable)
                          └─ otherwise → renderCmoPrompt      (conversation)
      5. generateText()       lib/services/llm.ts             provider chain + cache
      6. sanitizeCmoText()    strips any leaked internal labels
  → { text, intent, confidence, decision, evidence }
```

**Four prompt builders.** This is the single most important thing to know about this route.
Anything that must apply to every answer — a rule against inventing statistics, a tone rule
— goes in `lib/cmo/quality-rules.ts`, which all four import. Putting it in one builder means
it silently does not apply to the other three. That has happened.

### A work item is generated

```
Agent board "Draft post"
  → app/app/page.tsx  workItem()
      opens the doc panel immediately with <DocSkeleton/>   ← before the request
      → ai()  app/app/_lib/ai.ts
        → POST /api/generate    auth, rate limit, trial gate, URL safety
          → generateText()      lib/services/llm.ts
  → draft saved, panel fills
```

The panel opens on the press, not on the response. Generation takes as long as it takes;
what a user needs is evidence it started.

### A scheduled post publishes

```
GitHub Actions (every 10 min)  →  GET /api/cron/automation-publish
  → runDue()  lib/automation/runner.ts
      claim the slot   upcoming → publishing   (rejected if not upcoming — no double-claim)
      preflight        account connected? token live? ← BEFORE generating
      generate         content for the slot
      prePublish()     validate + optimise
      publishNow()     hands off to the M12 Publishing Engine with an idempotency key
```

Preflight runs before generation on purpose. Generating first meant a disconnected account
burned a model call per slot per run, and the day's token budget went on posts nobody saw.

---

## 7. Seven patterns you are expected to follow

### 7.1 Repository pattern, everywhere

Every store has two implementations behind one interface:

```ts
export interface ThingRepo { get(id: string): Promise<T>; save(t: T): Promise<T>; }
export class InMemoryThingRepo implements ThingRepo { ... }
export class NeonThingRepo implements ThingRepo { ... }
```

A `shared.ts` picks one based on whether `db()` returns a connection. Tests use in-memory and
never touch a database. If you add a store and skip this, your code becomes untestable.

### 7.2 Adapters own provider specifics

Platform rules — character limits, whether media is required, whether video is allowed —
live in `lib/social/adapters.ts` (and `adapters-live.ts` for the ones that really post),
read through `createAdapterRegistry()` in `lib/social/registry.ts`. Nothing outside those
files hardcodes `280`.

Same for LLM providers (`lib/services/llm.ts`) and market sources (`lib/market/sources.ts`).
Core services only ever see normalized types.

### 7.3 One orchestrator per concern

- **Job Engine** owns background work, queueing, retries.
- **Publishing Engine** owns publishing, backoff, dead-letter.
- **Execution Engine** owns campaign workflow state.
- **LLM service** owns provider routing, fallback, caching.

Need one of those behaviours? Call the engine. Do not build a second one.
`lib/automation/runner.ts` publishes nothing itself — it claims a slot and hands it to the
Publishing Engine. That is the shape to copy.

### 7.4 Deterministic by default, LLM at the edges

Planning, scheduling, health scoring, recurrence, intent routing and command parsing are all
deterministic functions with injectable clocks. That is what makes them testable, and what
makes an approved plan the plan that ships.

Never call `Date.now()` inside a pure function you want to test — take `now` as an argument.

### 7.5 Graceful degradation is a requirement

A dead market source degrades the market section, not the request. A missing database
degrades to in-memory. A failing provider degrades to the deterministic path.

**The rule: never silently produce a worse result.** If quality dropped, the payload says so
(`source: "deterministic"`, a lower `confidence`) and the UI shows it.

### 7.6 Idempotency on anything touching the outside world

Publishing carries an idempotency key the engine de-duplicates on. Automation slot ids are
content-addressed hashes of (automation, time), so re-expanding a schedule is a no-op. State
transitions are guarded, so two overlapping cron runs cannot both claim a slot.

### 7.7 Agents never orchestrate

Seven agents: Research, Strategy, Content, Creative, Publishing, Analytics, Learning.

They cannot call each other and cannot start work. The Execution Engine hands one agent one
step; its only inputs are the assembled context and that step, its only output a task record.
What one agent learns reaches the next through the Business Graph, Market Memory and the
Learning Engine.

This is enforced structurally — there is no handle to another agent to call.

---

## 8. Testing

```bash
npx vitest run
```

758 tests across 69 files. We test the **contract**, not the implementation:

- Illegal state transitions are refused (a published post cannot be un-published)
- A paused agent leaves no task record, so resuming replays no side effects
- Platform limits are asserted against the real adapter constraints
- Fallbacks mark themselves and reduce confidence
- Same inputs produce the same ids

**When you find a bug, write the test that catches it before you fix it.** A large number of
tests in this suite are named after the exact bug they prevent from returning — read a few,
they double as a history of what has gone wrong here.

---

## 9. Traps that have already caught people

Every one of these was a real incident. They are here so they cost you nothing.

**`SOCIAL_TOKEN_KEY` is write-once.** Tokens are sealed with it. Set it later, or change it,
and every previously connected account becomes undecryptable — the plaintext is gone and
every user must reconnect. Node reports this as the useless *"Unsupported state or unable to
authenticate data"*; we now throw `TokenKeyMismatchError` naming the variable.

**`X_CLIENT_ID` is not `X_PUBLISH_CLIENT_ID`.** The first is sign-in-with-X. Using it for
publishing arms the feature with scopes that lack `tweet.write` — every post 403s, with
nothing in the UI to suggest why.

**Never add host or protocol redirects in `next.config.ts`.** Vercel already redirects to the
primary domain. Adding the opposite redirect creates an infinite loop and takes the site
down. There is a test forbidding any redirect that matches on `host` or `x-forwarded-proto`.

**A model that 404s is dead for that key, forever.** Do not leave it in the chain hoping. The
LLM service now remembers unavailable models for the process lifetime.

**`NEXT_PUBLIC_*` is inlined at build time.** Flipping a flag needs a redeploy, not a restart.

**Vercel Hobby allows 2 cron jobs at daily granularity.** Anything more frequent runs from
GitHub Actions (`.github/workflows/publish.yml`).

**Check which code path actually runs before fixing it.** Three separate times a fix landed
in a prompt builder, a fallback, or an engine that the live request never reached. Trace the
call from the UI first.

---

## 10. Conventions

- **Comments explain why, not what.** If a line is surprising, say why it is that way.
- **Errors are sentences.** A raw API code must never reach a user's screen. Map it to
  language that says what happened and what to do next.
- **No placeholder UI.** No "Coming soon" on working features, no dead buttons, no fake
  metrics presented as real. Demo data lives in `demo-data.ts` and is labelled.
- **Icons, not emoji.** Use `app/components/Icon.tsx`. Emoji render differently on every
  platform, ignore the accent colour, and set the wrong tone.
- **Secret guard before every commit.** `git status --short` must never show `.env.local`,
  `*_key.txt` or `node_modules`.
- **Commits describe the decision and its reason**, not just the change.

---

## 11. Database migrations

Plain SQL in `db/migrations/`, applied in filename order (`YYYYMMDD_name.sql`).

`RUNTIME_DDL` gates request-time table creation for local development; production applies
migrations explicitly. Adding a table means adding a migration **and** the
`CREATE TABLE IF NOT EXISTS` in the Neon store, so local dev works without a migration step.

---

## 12. Your first week

1. Run the app. Paste a website. Watch the dashboard populate. Press things.
2. Read `lib/services/llm.ts` — the spine of every AI path, and the clearest example of
   provider fallback done carefully.
3. Read `lib/social/engine.ts` and one adapter — the clearest example of §7.1 and §7.2.
4. Read `lib/services/intent-router.ts` — small, deterministic, and it decides what the whole
   CMO route does.
5. Read `tests/campaign-execution.test.ts` and `tests/automation-runner.test.ts` — they show
   what we consider worth asserting.
6. Pick the `docs/milestone-*.md` for the area you will work in.

Good first tasks: add an icon to the set, add a rule to `quality-rules.ts` with the test that
proves it applies to all four prompt paths, or add a platform adapter.

---

## 13. What we look for in review

- Does it reuse the engine that already does this, or build a second one?
- Does it degrade honestly, and say so when it does?
- Is it testable without a network or a database?
- Does the error text help someone who is not you?
- **Can it double-post?**

If the answer to the last one is "probably not", that is not good enough. Make it impossible,
then write the test that proves it.
