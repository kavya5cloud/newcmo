# Populr Campaign Studio — Architecture

**The AI Marketing Operating System.** Not a content generator, not a scheduler:
a system that **decides → plans → creates → publishes → measures → learns**, in that
order, forever.

This document is grounded in the shipped codebase (Next.js 16 App Router + Neon
Postgres + the event-sourced intelligence layer in `lib/intel.ts`). Everything here
extends what exists; nothing replaces it.

---

## 1. Complete architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        POPULR OS                                │
│                                                                 │
│  ┌───────────────┐   every decision starts here                 │
│  │ BUSINESS      │   sources: website, IG, LinkedIn, X,         │
│  │ INTELLIGENCE  │   Reddit, YouTube, GBP → one Business        │
│  │ SERVICE       │   Profile (versioned, append-only)           │
│  └──────┬────────┘                                              │
│         ▼                                                       │
│  ┌───────────────┐   "what should this business do next?"       │
│  │ DECISION      │   ranks channels & plays from own history +  │
│  │ ENGINE        │   de-identified network outcomes + priors    │
│  └──────┬────────┘   (exists: /api/intel/next)                  │
│         ▼                                                       │
│  ┌───────────────┐   goal → campaign: audience, channels,       │
│  │ CAMPAIGN      │   timeline, priority, expected ROI,          │
│  │ PLANNER       │   reasoning. Campaign = decision container.  │
│  └──────┬────────┘                                              │
│         ▼                                                       │
│  ┌───────────────┐   one plan item → many assets:               │
│  │ CONTENT       │   post/thread/caption/carousel/reel-script/  │
│  │ STUDIO        │   reddit/blog/email/landing. Grounded in     │
│  │  ├ Carousel   │   profile + voice + goal + winning content.  │
│  │  ├ Video      │   Video/UGC = orchestration only (plans,     │
│  │  └ UGC        │   scripts, shot lists — providers plug in).  │
│  └──────┬────────┘                                              │
│         ▼                                                       │
│  ┌───────────────┐   approval-gated. v1: peak-window            │
│  │ PUBLISHING    │   reminders + copy-to-clipboard.             │
│  │ ENGINE        │   v2: per-channel OAuth connectors.          │
│  └──────┬────────┘   Nothing ships without the human.           │
│         ▼                                                       │
│  ┌───────────────┐   GSC snapshots (exists) + per-asset         │
│  │ ANALYTICS     │   performance + campaign progress.           │
│  │ ENGINE        │   Weekly cron, append-only snapshots.        │
│  └──────┬────────┘                                              │
│         ▼                                                       │
│  ┌───────────────┐   recommendation → action → outcome          │
│  │ LEARNING      │   (exists) + asset-level signals             │
│  │ ENGINE        │   (approved/rejected/edited/published/       │
│  └──────┬────────┘   performance) → better future decisions     │
│         │                                                       │
│         └────────────► feeds back into DECISION ENGINE          │
│                                                                 │
│  cross-cutting: NOTIFICATION ENGINE (outcome pushes — exists),  │
│  CACHING (exists), OBSERVABILITY (structured JSON logs)         │
└─────────────────────────────────────────────────────────────────┘
```

**Prime directive (design principle, enforced in code):** no generation endpoint
accepts a request without a `campaign_id` or `recommendation_id`. Content can only
be created *from a decision*. This is what separates an OS from a toy.

**Two refinements (adopted):**
1. **Creative Brief layer** — every campaign produces a brief *before* any asset:
   objective, audience, key message, emotional angle, proof, CTA, visual direction,
   success metric. All assets generate from the brief, keeping a campaign's content
   consistent. Stored as `campaigns.brief` JSONB, validated server-side
   (`lib/services/campaign-validate.ts`) — the LLM plans it, but nothing enters the
   database unless the brief contract is complete.
2. **Marketing Missions naming** — user-facing language is missions the CMO assigns
   ("Launch a product", "Increase organic traffic"), not "recommendations"/tips.
   The full chain: Mission → Campaign → Creative Brief → Assets → Results.

Phase 1 (shipped): `lib/services/{contracts,decisions,campaigns,campaign-validate}.ts`,
`/api/campaigns` + `/api/campaigns/[id]/events`, `/app/campaigns` Missions UI.
Campaign tasks are logged as recommendations (`rec_type=mission_task`), so mission
work feeds the same recommendation → action → outcome dataset as the feed.

---

## 2. Service boundaries — modular monolith, not microservices

**Deliberate architectural call:** at the current stage (one engineer, one Vercel
deployment, <1K users) physical microservices would be a self-inflicted wound —
9 deploys, 9 cold-start profiles, distributed failures, no benefit. Instead:
**each service is a TypeScript module with a hard interface** in `lib/services/`.
The interfaces are the contract; extraction to real services later is mechanical
(the boundary already exists, only the transport changes).

```ts
// lib/services/contracts.ts — the ONLY way services talk to each other
export interface BusinessIntelligence {
  analyzeSource(src: SourceRef, hint?: string): Promise<BusinessProfile>;
  profileFor(wsKey: string, website: string): Promise<BusinessProfile | null>;
}
export interface DecisionEngine {
  nextActions(wsKey: string, ctx: ProfileCtx): Promise<RankedAction[]>;   // exists
  scoreCampaignPlan(plan: CampaignPlan): Promise<PlanScore>;
}
export interface CampaignPlanner {
  plan(goal: CampaignGoal, profile: BusinessProfile, decisions: RankedAction[]): Promise<CampaignPlan>;
}
export interface ContentStudio {
  generateAsset(req: AssetRequest): Promise<Asset>;        // requires campaignId
  generateSet(rec: RecommendationRef): Promise<Asset[]>;   // one rec → many formats
}
export interface PublishingEngine {
  schedule(assetId: string, windowHint?: PublishWindow): Promise<ScheduledPost>;
  markPublished(assetId: string, meta: PublishMeta): Promise<void>;
}
export interface AnalyticsEngine {
  snapshot(wsKey: string): Promise<OutcomeSnapshot[]>;     // exists (cron)
  campaignProgress(campaignId: string): Promise<CampaignMetrics>;
}
export interface LearningEngine {
  attribute(): Promise<ScoredOutcome[]>;                   // exists (cron)
  contentSignals(wsKey: string, channel: string): Promise<WinningTraits>;
}
export interface NotificationEngine {
  bestNote(prev: Snapshot, cur: Snapshot): string | null;  // exists
  notify(userId: string, note: HighValueNote): Promise<void>;
}
export interface VideoEngine {                              // orchestration only
  plan(assetId: string): Promise<VideoPlan>;
  submit(planId: string, provider: VideoProvider): Promise<VideoJob>;
  poll(jobId: string): Promise<VideoJobStatus>;
}
```

Rules:
- Services import `contracts.ts` and their own module — **never each other's internals**.
- All cross-service data flows through the database (event-sourced) or the contract.
- Every contract call emits a structured log event (existing `logEvent` convention).

---

## 3. Database changes

All append-only unless marked registry. All created idempotently in
`lib/services/schema.ts` (extends the existing `ensureIntelTables` convention).
Existing tables (`recommendations`, `recommendation_events`, `outcome_snapshots`,
`business_profiles`, `content_assets`, `recommendation_scores`, `websites`,
`marketing_channels`) are untouched.

```sql
-- STEP 2: campaigns are decision containers
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_key TEXT NOT NULL,
  website TEXT NOT NULL,
  goal TEXT NOT NULL,              -- launch_product | grow_seo | go_viral | leads | hiring | fundraising | custom
  title TEXT NOT NULL,
  audience TEXT,
  channels TEXT[] NOT NULL,
  timeline_days INT NOT NULL,
  priority INT NOT NULL DEFAULT 3, -- 1 highest
  expected_roi TEXT,               -- narrative, never fake numbers
  reasoning TEXT NOT NULL,         -- WHY this plan (decision-first receipt)
  plan JSONB NOT NULL,             -- ordered plan items w/ channel, week, intent
  business_profile_id UUID,
  status TEXT NOT NULL DEFAULT 'draft', -- draft|active|paused|completed|archived
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaigns_ws ON campaigns (workspace_key, created_at DESC);

CREATE TABLE campaign_events (        -- same event-sourcing pattern as recommendations
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id),
  event TEXT NOT NULL,                -- created|activated|paused|completed|item_done|archived
  actor TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- STEP 3 + 9: content memory. EXTENDS content_assets (registry of every generated asset)
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS campaign_id UUID;
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS asset_type TEXT;      -- linkedin_post|x_thread|ig_caption|ig_carousel|ig_reel_script|reddit_post|blog|email|landing_copy|video_plan|ugc_plan
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS structure JSONB;      -- typed payload (slides, scenes, …)
ALTER TABLE content_assets ADD COLUMN IF NOT EXISTS prompt_version TEXT;

CREATE TABLE asset_events (           -- approved/rejected/edited/published/performance
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES content_assets(id),
  event TEXT NOT NULL,                -- generated|viewed|edited|approved|rejected|published|performance
  actor TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,  -- edit diff summary, perf metrics, publish url
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_events ON asset_events (asset_id, created_at);

-- STEP 4: carousels live in content_assets.structure as typed JSONB:
-- { slides: [{ n, title, description, layout, icons[], illustrationPrompt, cta? }] }
-- exported via /api/studio/assets/:id/export (JSON project, editable)

-- STEP 5: video orchestration (no local generation)
CREATE TABLE video_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES content_assets(id),   -- the video_plan asset
  provider TEXT NOT NULL,             -- 'manual' | future: runway|pika|heygen|…
  provider_job_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned', -- planned|submitted|rendering|done|failed
  result_url TEXT,
  cost_cents INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- STEP 8: notification log (dedupe + audit; extends sent_reminders pattern)
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- outcome|competitor|rank|publish_window|campaign_done
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_at TIMESTAMPTZ
);
```

**Content memory query** (Step 9 → Step 3 loop): before generating, Content Studio
pulls `WinningTraits` — the user's approved-and-high-performing assets per channel
(`asset_events` approved/published + performance joined to `content_assets`) — and
injects a compact digest into the generation prompt ("your audience responded to:
…"). Rejected assets contribute negative examples. This is the moat compounding at
the asset level.

---

## 4. API changes

Existing routes untouched. New surface (all rate-limited, workspace-scoped,
same auth pattern):

```
POST /api/campaigns                    goal + profile → planned campaign (decide→plan)
GET  /api/campaigns?wsid=              list with progress
POST /api/campaigns/:id/events         activate/pause/complete/item_done
POST /api/studio/generate              { campaignId|recommendationId, assetType } → asset
POST /api/studio/generate-set          one recommendation → full multi-format set
GET  /api/studio/assets?campaignId=    content memory browser
POST /api/studio/assets/:id/events     approved|rejected|edited|published|performance
GET  /api/studio/assets/:id/export     carousel/video plan as editable JSON project
POST /api/video/jobs                   submit plan to a provider (v1: 'manual')
GET  /api/video/jobs/:id               poll status
GET  /api/dashboard/brief?wsid=        the CMO morning brief (score, priorities, alerts)
```

Guardrails:
- `/api/studio/generate*` **rejects** requests with no campaign/recommendation
  linkage (`400 decision_required`) — the prime directive, enforced.
- Every generation logs to `content_assets` + `asset_events('generated')`
  automatically. Memory capture is not optional.
- Marketing Score (dashboard) is computed transparently: weighted blend of
  campaign progress %, approval-queue freshness, snapshot deltas, and channel
  coverage — formula documented in the response so it's never a mystery number.

---

## 5. UI redesign — the AI CMO workspace

Route map (App Router):

```
/app                 → CMO workspace (morning brief replaces current dashboard top)
/app/campaigns       → campaign list + "Start a campaign" (goal picker)
/app/campaigns/[id]  → campaign room: plan timeline, assets per item, progress
/app/studio/[asset]  → asset editor (carousel slides, scripts, posts) + approve/reject
/worked              → exists (outcome rankings) — linked from brief
```

Morning brief (top of `/app`, replaces static hero):

```
Good morning, Kavya.
MARKETING SCORE 72 ▲3        (click → how it's computed)

TODAY'S PRIORITIES                     CAMPAIGN PROGRESS
1. Approve 3 drafts waiting (2 days)   Launch: week 2/4 ▓▓▓▓▓░░░ 61%
2. "best crm" slipped 2 spots → fix    SEO:    week 1/6 ▓▓░░░░░░ 18%
3. Publish window for X in 2h
                                       WINNING CHANNELS (from /worked data)
COMPETITOR ALERTS                      reddit ↑  ·  seo →  ·  x ↓
okara.ai published 2 posts this week
```

Every line is a button that deep-links to the action. No decorative widgets:
if it isn't actionable, it isn't on the brief. Existing design language
(Inter + Geist Mono, dark, green accent) carries over — no visual rebrand.

Onboarding: existing source row gains **💬 reddit** (`u/username` →
`reddit.com/user/username` — old Reddit HTML is scrapeable). All sources
already converge into one Business Profile (shipped).

---

## 6. Folder structure

```
lib/
  services/
    contracts.ts          ← all interfaces (section 2)
    schema.ts             ← idempotent DDL for new tables
    intelligence.ts       ← wraps existing analysis + profiles
    decisions.ts          ← wraps /api/intel/next logic
    campaigns.ts          ← planner
    studio/
      index.ts            ← generateAsset / generateSet dispatch
      formats.ts          ← per-asset-type prompt builders + JSON schemas
      carousel.ts         ← slide model, validation, export
      video.ts            ← plan pipeline (script→scenes→shots→prompts→VO→music→subs)
      ugc.ts              ← talking-head script, b-roll, hook, CTA, directions
    publishing.ts         ← schedule/markPublished (v1 reminder-based)
    analytics.ts          ← wraps snapshot cron logic + campaign metrics
    learning.ts           ← wraps attribution + WinningTraits
    notifications.ts      ← wraps bestOutcomeNote + notification log
    video-providers/
      types.ts            ← VideoProvider interface
      manual.ts           ← v1: human executes the plan (status tracking only)
app/api/
  campaigns/…  studio/…  video/…  dashboard/brief/
app/app/campaigns/…  app/app/studio/…
docs/
  intelligence.md         ← exists
  campaign-studio-architecture.md  ← this file
tests/
  intel-score.test.ts     ← exists
  campaign-plan.test.ts   studio-formats.test.ts  carousel.test.ts
```

Existing `lib/intel.ts`, `lib/ai-cache.ts`, `app/api/generate`, `app/api/intel/*`,
crons: untouched. Services wrap them; they don't move.

---

## 7. Event flow

```
user picks goal
  → campaign_events(created)                       [Campaign Planner]
  → recommendations rows for each plan item        [existing intel tables]
user opens plan item → generate
  → content_assets row + asset_events(generated)   [Content Studio]
user approves / rejects / edits
  → asset_events(approved|rejected|edited)         [Content Memory]
  → recommendation_events(approved|dismissed)      [existing]
user publishes (reminder fires at peak window)
  → asset_events(published) + campaign_events(item_done)
weekly cron
  → outcome_snapshots (exists)
  → recommendation_scores (exists)
  → asset_events(performance) for published assets
  → notifications(kind=outcome|rank|competitor)
learning loop
  → WinningTraits recomputed → injected into next generation
  → channel effectiveness → /api/intel/next → next campaign plans
```

One direction, no cycles except the intended big one: **learn → decide**.

## 8. Sequence diagrams

**Campaign creation (decide-first, enforced):**
```
User          Planner        DecisionEngine     LLM            DB
 │ pick goal     │                │              │              │
 │──────────────►│ nextActions()  │              │              │
 │               │───────────────►│ (data, no    │              │
 │               │◄───────────────│  LLM call)   │              │
 │               │ plan(goal, profile, ranked)───►│ (language    │
 │               │◄───────────────────────────────│  only)       │
 │               │ INSERT campaign + plan items + reasoning─────►│
 │◄──────────────│ campaign w/ WHY attached       │              │
```

**Asset generation with content memory:**
```
User        Studio        Learning       LLM           DB
 │ generate    │              │            │             │
 │────────────►│ contentSignals(ws,chan)   │             │
 │             │─────────────►│ (SQL over asset_events)  │
 │             │◄─────────────│ WinningTraits            │
 │             │ prompt = profile+voice+goal+traits──────►│
 │             │◄──────────────────────────│ asset       │
 │             │ INSERT content_assets + asset_events────►│
 │◄────────────│ asset (approve/reject UI) │             │
```

**Video orchestration (provider-agnostic):**
```
Studio → video.plan(): script → scenes → shots → visual prompts → VO → music → SRT
       → content_assets(asset_type=video_plan, structure=pipeline JSON)
User   → submit to provider ('manual' v1)
       → video_jobs(planned→submitted→rendering→done) ← provider adapter polls
       → done: result_url on job, asset_events(published) when user ships it
```

---

## 9. Future scalability plan

| Trigger | Move |
|---|---|
| >100 GSC-connected users | paginate snapshot cron across runs (cursor in DB) |
| >100K recommendations | materialized rollups for network-layer aggregates |
| Generation latency hurts | queue generations (Vercel Queues / Inngest), stream results |
| First real video provider | implement `VideoProvider` adapter; `video_jobs` schema already fits |
| Publishing APIs approved | `publishing.ts` gains connectors (X API, LinkedIn API, Meta Graph); the approval-gate stays |
| Team plan / seats | `workspace_members` table; wsKey already abstracts identity |
| Service extraction needed | contracts.ts interfaces become HTTP/queue boundaries; DB per service last |
| Model training (the moat) | reward model on asset_events approvals; ranker on recommendation_scores — schema already training-ready (see intelligence.md) |

Honest external dependencies to plan around (not code problems):
X/LinkedIn/Meta developer-app approvals take weeks and have costs; video providers
bill per render; competitor monitoring needs a crawl budget. Sequence accordingly.

## 10. 90-day execution roadmap

**Days 1–15 — Foundations (high certainty)**
- `contracts.ts` + `schema.ts` + service wrappers around existing code
- Reddit source in onboarding
- Campaigns: table, planner (goal → plan via decision engine + LLM), `/app/campaigns`
- Ship: users can create a Launch/SEO/Leads campaign with reasoning attached

**Days 16–35 — Content Studio core**
- `formats.ts`: linkedin_post, x_thread, ig_caption, reddit_post, blog, email (text formats first)
- generate-set (one rec → all formats), asset editor UI, approve/reject/edit events
- Content memory v1: WinningTraits injected into prompts
- Ship: one click turns a plan item into a channel-ready content set

**Days 36–55 — Carousel + dashboard**
- Carousel builder (slide model, layouts, illustration prompts, JSON export)
- CMO morning brief replaces dashboard top (score, priorities, campaign progress, winning channels — all real data, no invented numbers)
- Ship: the workspace feels like a CMO, not a tool

**Days 56–75 — Video/UGC orchestration + notifications v2**
- video.plan() + ugc.ts pipelines, video_jobs with 'manual' provider
- Notifications: publish-window, campaign-completed, rank-slip (competitor alerts deferred until crawl budget exists — no fake alerts)
- Ship: complete video/UGC production plans, trackable to done

**Days 76–90 — Learning loop closure + hardening**
- asset_events(performance) fed from snapshots; WinningTraits v2 (negative examples)
- Marketing Score v1 with transparent formula
- Load/failure audit (same bar as the intelligence-layer audit), docs, tests
- Ship: the flywheel visibly turns — generations cite what worked before

Cut lines if time compresses: carousel export formats, UGC camera directions,
score animations. Never cut: decision-first enforcement, event logging, honesty
guards.

---

*Design principles, restated as tests the codebase must always pass:*
1. No asset without a decision (`decision_required` guard).
2. No overwritten history (append-only audit — already enforced).
3. No invented numbers anywhere a user looks (withHonestSummaries precedent).
4. No claim of causality — association + confidence only.
5. Nothing publishes without the human.
