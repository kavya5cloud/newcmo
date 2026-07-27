# Content Creation

Content creation is reachable in two clicks from anywhere: a **Create content** section on
the home page and a **Create Content** quick action on the dashboard, both pointing at the
existing Creative Studio. No new routes, no new navigation layer.

## Generation runs on the existing LLM orchestration

`lib/content/ai.ts` and `lib/ugc/ai.ts` generate through `lib/services/llm` — the layer that
already owns provider routing (Groq → Gemini → OpenAI), model fallback, retry with backoff,
quota handling, response caching, in-flight de-duplication and structured logging. No second
AI layer was introduced and none of that was re-implemented.

**Every generation consumes one assembled context** (`lib/content/generation-context.ts`):
brand voice from the Learning Engine's Brand DNA, audience, market intelligence, competitors,
opportunities and keywords from M13, recall from Market Memory, top patterns from the Pattern
Library, and each connected platform's hard limits from the M12 adapters. Sources degrade
independently, and the prompt **names what is missing** rather than omitting the heading — a
model told "market intelligence unavailable" writes differently from one that never saw the
section, and the difference is whether it invents competitors.

**The deterministic engines were not deleted — they were demoted to the floor.** With no API
key, a failing provider, or output that doesn't parse, the product still returns a usable
draft and says plainly that a model didn't write it. Silently degrading to worse text with no
marker is the one failure mode a founder cannot detect.

**Model output is not trusted on limits.** The model is asked to count characters and is
usually close, but the adapters are the contract: any variant that overruns is cut at a
sentence boundary and the note says it was cut.

Every response carries `source`, `provider`, `model`, `confidence`, `reasoning` and
`degradedReason`, and the UI shows them above the output. Confidence is the model's own
number, reduced when context was missing.

**Generation metadata** goes to Market Memory (`lib/content/generation-log.ts`) where the
Learning Engine and the Research agent already read — provider, model, confidence, format and
whether a model wrote it at all — so that when those posts report performance, the
correlation between how something was made and how it did is available rather than lost.

### Not implemented, deliberately

Token-level streaming. `generateText` returns a complete response; adding an SSE token stream
means changing the orchestration layer itself, which is a larger change than this brief
allows and would risk the M10–M15 paths that depend on it. **Cancellation is real** — the
request aborts on client disconnect and returns the deterministic draft rather than finishing
work nobody is waiting for.

## One prompt → a publishable set

`lib/content/compose.ts` turns one sentence into the piece, a variant per connected
platform, hashtags, CTA options, a posting schedule and a campaign suggestion.

**Nothing here invents platform rules.** Character limits and media requirements come from
the M12 adapters; posting windows come from the existing publish-time model. A platform
changing its limits changes this output with no code edit.

**Trimming is honest.** A blog that doesn't fit X's 280 characters is cut at the last
complete sentence and the variant says it was cut — rather than a mid-word ellipsis shipped
as if it were written that way. A platform requiring media is flagged before anything is
queued.

**No connected platforms means no variants**, not invented ones. The UI says so and points
at Cross-Post.

Formats: post, thread, blog, email, landing page, product announcement, carousel — each
with a genuinely different structure, all built from the prompt's own words.

## UGC — the workflow that was missing

`lib/ugc/` is new capability, not a rewrite: the studio previously had a UGC section badged
"Soon".

| Piece | What it does |
| ----- | ------------ |
| Hooks | Five ranked openings, each with the reason it should stop a scroll. Format-aware — the hook that wins a testimonial isn't the one that wins a demo. |
| Scripts | Timed scenes with the line *and* what's on screen, per format. |
| Creator styles | Founder, power user, won-over skeptic, practitioner, first-timer — each rewrites the opening, not just a label. |
| Voice styles | Calm, energetic, conversational, authoritative, warm — delivery direction for whoever shoots it. |
| Versions | Up to five, differing in creator and voice style, so a founder chooses a read rather than a synonym. |
| CTAs | Soft, direct, curiosity. |
| Edit / approve | Per version. Editing recomputes word count. |

The objection hook only appears when an objection was supplied — the engine won't fabricate
a doubt to answer.

**Approved UGC becomes an ordinary draft.** From there it uses the same scheduling,
publishing, retry and approval paths as every other post. There is no second publishing
pipeline for video.

## Publishing

Generate → preview → publish, schedule or save as draft, in one click, through the existing
Publishing Engine. Idempotent on the composed id, so re-running the same prompt never
double-posts. Retries, failures and approvals live where they always did, in Cross-Post.

## APIs

- `POST /api/content/compose` — compose; add `publish: "draft" | "schedule" | "now"` to ship it
- `GET|POST /api/ugc` — `generate | edit | approve | reject | to_draft`

Both reuse the Publishing Engine, Job Engine, adapters and publish-time model. No new
orchestration.

## What was removed

The `Soon` badges in the studio, and the `aria-disabled` on asset cards. The Generate button
behind them already created a real Job Engine job — a card that looked disabled next to a
working button was the worst of both.

## Tests

`tests/content-creation.test.ts` — 24 deterministic tests: composer determinism, per-format
structure, adapter-sourced limits, sentence-boundary trimming, media flags, empty-platform
behaviour, schedule staggering and honest rationale; UGC hook ranking, objection gating,
brief-derived scripts, per-format scripts, version variation, approval isolation, edit
recomputation, and a regression for acronym casing in style prefixes.
