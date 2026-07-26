# Milestone 13 — Opportunity Detection & Market Intelligence

Populr stops only reporting analytics and starts **discovering opportunities**. Strictly
additive: no Publishing / OAuth / Scheduler / Queue / Asset / Webhook / Draft / Integration
code from Milestone 12 was touched.

```
sources → SignalAggregator → Trend / Competitor / Keyword / Audience services
        → OpportunityEngine → BusinessGraphService + MarketMemory → dashboards
```

## Layout — `lib/market/`

| File | Responsibility |
| ---- | -------------- |
| `types.ts` | `MarketSignal`, `Trend`, `CompetitorProfile`, `KeywordInsight`, `Opportunity`, `MarketGraph`, `MemoryRecord`, typed `MarketError`, pagination |
| `sources.ts` | Adapters (Google Trends, Reddit, News, RSS, competitor web, social, analytics) + registry |
| `aggregator.ts` | **SignalAggregator** — caching, rate limiting, retry, incremental refresh, dedupe, graceful degradation |
| `trends.ts` | **TrendService** — corroboration-weighted confidence; viral/seasonal/emerging/industry |
| `competitors.ts` | **CompetitorService** — frequency, engagement trend, mix, growth, top posts, gaps |
| `keywords.ts` | **KeywordService** — discovery, winnable-demand scoring, history, clustering |
| `audience.ts` | **AudienceInsightService** — interests, channels, shift detection |
| `opportunities.ts` | **OpportunityEngine** — ranked, evidence-backed cards |
| `graph.ts` | **BusinessGraphService** — extends the canonical projection with market entities |
| `memory.ts` | **MarketMemory** — versioned history + seasonality |
| `research.ts` | **ResearchService** — one full pass; optional narrative |

## Design decisions worth knowing

**Provider isolation.** Every provider quirk lives in a source adapter. Core services only
ever see the normalized `MarketSignal`, so swapping a reference adapter for a real API
requires no change to any service — the same contract the Milestone 12 platform adapters use.

**Confidence rewards corroboration.** A topic seen by three independent sources scores far
higher than one loud source shouting. This is asserted directly in the tests, because it's
the difference between intelligence and noise.

**Keywords favour winnable demand.** Opportunity = volume + growth, *discounted by how
contested a term looks*. A rising long-tail term beats a brutal head term — the decision a
marketer actually needs.

**Every opportunity carries its evidence.** Cards ship an `evidence[]` array of concrete
observed facts so a founder can audit a claim instead of trusting a score.

**Honest about thin data.** A competitor with no observed activity returns *"No observed
activity"* rather than a fabricated profile, and confidence scales with sample size.

**Graceful degradation.** A dead source is reported in `failed[]`, never thrown — the brief
still ships from whatever succeeded. Covered by a test that injects a failing adapter.

## Reuse, not duplication

- **Business Graph** — `BusinessGraphService` merges the canonical `lib/business-graph`
  projection (campaigns, channels) and layers market entities on top. That module remains
  the source of truth.
- **Job Engine** — background collection enqueues a `market_research` job on the existing
  M11 engine (`POST /api/market/research` with `background: true`). No second orchestration
  layer was introduced.
- **LLM** — narratives and campaign ideas go through the existing `lib/services/llm`.
  Both are optional: the brief is complete without a model.
- **JSON parsing** — reuses `lib/llm-json` (truncation-tolerant).

## APIs

`/api/market/{research,trends,competitors,keywords,opportunities,graph,memory}` —
all paginated (`?offset=&limit=`), rate limited, with typed errors.
`?node=` on `graph` returns a single node's neighbourhood.

## Dashboard

`/studio/market` — Opportunity Feed, Trend Explorer, Competitor Dashboard, Keyword
Explorer, Business Graph Viewer and Research Center.

## Database

Migration `db/migrations/20260728_milestone_13.sql` adds `market_memory` (indexed by
tenant/kind/time and by key for per-subject history).

## Tests

`tests/market-intelligence.test.ts` — 29 deterministic tests: adapter normalization and
`since` handling, aggregator caching + injected-failure degradation, corroboration scoring,
competitor honesty with thin data, winnable-demand ranking, evidence completeness, graph
content hashing, memory versioning, seasonality and full end-to-end determinism.
