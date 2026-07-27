# Content Creation

Content creation is reachable in two clicks from anywhere: a **Create content** section on
the home page and a **Create Content** quick action on the dashboard, both pointing at the
existing Creative Studio. No new routes, no new navigation layer.

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
