# Populr Intelligence Layer

The recommendation → action → outcome dataset. This is the moat: every recommendation,
every customer decision, and every measurable outcome is recorded append-only from day
one. The LLM is the language interface; this dataset (and the ranking logic on top of
it) is the proprietary layer that compounds with every customer.

## Architecture

```
Foundation LLM (Gemini / Groq / OpenAI)     ← language interface, swappable
            ↓
Decision Engine (/api/intel/next)           ← ranks what to do next, from data
            ↓
Outcome database (Neon Postgres)            ← event-sourced, append-only
            ↓
Attribution scoring (weekly cron)           ← before/after deltas, association scores
            ↓
"What Actually Worked" (/worked)            ← customer-facing proof
```

## Data model (all tables created idempotently by `ensureIntelTables` in `lib/intel.ts`)

| Table | Purpose | Write policy |
|---|---|---|
| `recommendations` | Every recommendation ever generated: workspace, site, channel, title, prompt_version, provider/model, versioned business-profile reference | Append-only |
| `recommendation_events` | Every lifecycle transition: generated → viewed → edited → drafted → approved → dismissed → scheduled → published → completed → expired, with actor + metadata + timestamp | Append-only |
| `content_assets` | Every produced deliverable body, linked to its recommendation | Append-only |
| `business_profiles` | Versioned snapshots of the analyzed company profile (a new version per analysis) | Append-only |
| `outcome_snapshots` | Weekly GSC captures per connected site: impressions, clicks, CTR, position, top queries, top pages | Append-only, never overwritten |
| `recommendation_scores` | Computed attribution rows: before/after snapshot refs, delta JSON, association score, confidence | Append-only (unique per rec+snapshot pair) |
| `websites` | Registry of analyzed sites per workspace | Upsert (registry, not history) |
| `marketing_channels` | Static channel catalog | Seeded once |
| `approval_history` | SQL view over `recommendation_events` (approved/dismissed/published) | View |

Workspace keys are server-derived (`user:<id>` for signed-in users — unspoofable;
`anon:<wsid>` otherwise), matching the `/api/state` pattern.

## Event flow

1. **Generation** — after the feed is generated in `app/app/page.tsx`, the client posts
   the batch to `POST /api/intel/recommendations`. The server stores the rows plus a new
   `business_profiles` version and returns `clientKey → UUID`, kept in workspace state.
2. **Transitions** — drafting a deliverable, approving, and marking published each post
   to `POST /api/intel/events` (fire-and-forget; UI never blocks on logging). Drafted
   events also store the deliverable body as a `content_asset`.
3. **Outcomes** — the weekly cron `GET /api/cron/outcome-snapshots` (Mondays 06:00 UTC,
   `vercel.json`) snapshots the last-7-day GSC metrics for every connected site.
4. **Attribution** — the same cron then finds approved recommendations that have a
   snapshot before approval and one ≥6 days after, computes the metric delta, and stores
   an association score + confidence in `recommendation_scores`.

## Scoring (pure functions in `lib/intel-score.ts`, tested in `tests/intel-score.test.ts`)

- **Delta** — percent change in impressions/clicks/CTR plus absolute position change.
- **Association score ∈ [0,1]** — 0.5 = no movement. Weighted: clicks 45%, impressions
  25%, CTR 15%, rank improvement 15%. **This is deliberately an association, not a causal
  claim** — a single before/after observation can't separate the action from seasonality
  or algorithm updates. Causal-ish signal emerges only in aggregate (approved vs.
  not-approved recommendations across many sites), which is exactly what the dataset
  enables later.
- **Confidence ∈ [0,1]** — log-scaled data volume (~0 below 50 weekly impressions, ~0.5
  at 500, 1 near 5000+), so tiny noisy sites don't dominate.

## Decision engine v1 (`GET /api/intel/next`)

Ranks channels for a workspace by blending three layers with evidence-proportional
weights (shrinkage toward the prior):

1. the workspace's own approval history + measured outcome scores (up to 60% weight,
   fully earned at ~20 recommendations),
2. global **aggregated, de-identified** channel effectiveness across all customers
   (up to 30%, earned at ~200), and
3. neutral priors (the remainder — dominant during cold start).

The global layer only ever aggregates at channel level; no workspace, site, or content
identifiers cross customer boundaries (see ToS §5 / Privacy §2).

## Future training (explicitly NOT done now)

The schema is designed so we can later train, without migration:
- **reward models** — `recommendation_events` (approve/dismiss) are preference labels
  over `recommendations` + `business_profiles` context;
- **ranking models** — `recommendation_scores` are outcome labels;
- **retrieval** — `content_assets` + profiles form a grounded example store;
- **fine-tunes** — (profile, recommendation, outcome) triples are instruction data.

`prompt_version` / `snapshot_version` columns keep rows comparable across prompt changes
(bump `PROMPT_VERSION` env when the recommendation prompt shape changes).

## Observability

Structured JSON logs (same `console.info` convention as `/api/generate`):
`intel_recommendations_logged`, `intel_rec_event`, `outcome_snapshots_captured`,
`attribution_pass_complete`, `outcome_snapshot_error`, `attribution_error`, plus the
existing `llm_*`, `*_cache_*` events.
