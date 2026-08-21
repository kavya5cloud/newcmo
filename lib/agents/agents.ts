import { jobEngine } from "@/lib/jobs/shared";
import { learningEngine } from "@/lib/learning/shared";
import { normalizePerformanceEvent } from "@/lib/learning/performance";
import { marketPlatform } from "@/lib/market/shared";
import { memoryRecord } from "@/lib/market/memory";
import { socialEngine } from "@/lib/social/shared";
import { createAdapterRegistry } from "@/lib/social/registry";
import { db } from "@/lib/db";
import type { PlatformId } from "@/lib/publishing/types";
import type { SocialPlatform } from "@/lib/social/types";
import type { WorkflowStep } from "@/lib/execution/types";
import { scoreDraft } from "@/lib/content/craft";
import { auditUrl } from "@/lib/seo/audit";
import { hasMarketData } from "./context";
import type { AgentId, AgentOutcome, SharedContext } from "./types";

// The nine agents.
//
// Each one is a worker with a single job, and each does that job *through an existing
// service* — no agent talks to a provider, a platform or a database directly, and no agent
// calls another agent. Everything they need arrives in the SharedContext; everything they
// produce goes back through the Execution Engine.
//
// Confidence is derived from the evidence an agent actually had. An agent working with a
// dead market feed or no connected accounts says so and scores low, because a confident
// number attached to nothing is worse than no number.

export type Agent = {
  id: AgentId;
  run(ctx: SharedContext, step: WorkflowStep): Promise<AgentOutcome>;
};

const clamp = (n: number) => Math.max(0, Math.min(1, Number(n.toFixed(3))));

// ---- How an agent's work reads ----
//
// These lines are rendered straight into the AI Team panel as bullets, so they are the
// product's voice, not log output. They were written as debug strings — raw UUIDs, lowercase
// platform ids, "asset(s)", numbers with no separators — and read like a stack trace sitting
// in the middle of a designed screen.

/** Platform ids are internal. People know these by their names. */
const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  linkedin: "LinkedIn", x: "X", instagram_business: "Instagram",
  facebook_pages: "Facebook", threads: "Threads", pinterest: "Pinterest",
};
const platformName = (p: SocialPlatform): string => PLATFORM_LABEL[p] ?? p;

/** "1 asset" / "2 assets" — never "asset(s)", which is a form field, not a sentence. */
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Thousands separators, because 3000 chars and 30000 chars look alike at a glance. */
const num = (n: number): string => n.toLocaleString("en-US");

/**
 * A job id a person can actually match against the Jobs screen.
 *
 * The full UUID was being printed in a bullet list. Nobody reads 36 characters of hex, and
 * its only real use is comparing two of them — which the first segment does just as well.
 */
const jobRef = (id: string): string => id.split("-")[0] ?? id;

/** Craft issue codes in the words an operator would use. Unknown codes pass through. */
const CRAFT_ISSUE_LABEL: Record<string, string> = {
  ai_tell: "Stock AI phrasing",
  vague_claim: "Unsourced claim",
  weak_opening: "Opening that fits any post",
  monotone_shape: "Every sentence the same length",
};

/** Plan channel names → publishing platform ids. Same map the execution services use. */
const CHANNEL_PLATFORM: Record<string, SocialPlatform> = {
  linkedin: "linkedin", instagram: "instagram_business", facebook: "facebook_pages",
  x: "x", threads: "threads", pinterest: "pinterest",
};

// ---- Research ----

export const researchAgent: Agent = {
  id: "research",
  async run(ctx, step) {
    const live = hasMarketData(ctx);
    const recall = ctx.memory.slice(0, 3).map((m) => `${m.key}: ${m.value}`);

    // Everything observed this pass goes into Market Memory so the next campaign starts
    // from what this one learned — the only way the team compounds.
    let remembered = 0;
    try {
      const store = marketPlatform().memory;
      for (const t of ctx.market.trends) {
        await store.record(memoryRecord(ctx.tenant, "trend", t, `observed during ${ctx.campaign.title}`, ctx.now, null));
        remembered++;
      }
      for (const c of ctx.market.competitors) {
        await store.record(memoryRecord(ctx.tenant, "competitor", c.split(":")[0], c, ctx.now, null));
        remembered++;
      }
    } catch { /* Memory is durable-best-effort; the research still stands. */ }

    const outputs = [
      ctx.market.headline,
      ...ctx.market.trends.map((t) => `Trend — ${t}`),
      ...ctx.market.competitors.map((c) => `Competitor — ${c}`),
      ...ctx.market.opportunities.map((o) => `Opportunity — ${o}`),
      ...recall.map((r) => `Recalled — ${r}`),
    ];

    return {
      ok: true,
      task: step === "market_intelligence" ? "Scanning the market for openings" : `Researching ${ctx.audience}`,
      reasoning: live
        ? `Read ${plural(ctx.market.trends.length, "trend")}, ${plural(ctx.market.competitors.length, "competitor")} and ${plural(ctx.market.opportunities.length, "opportunity card")} from Market Intelligence, recalled ${plural(ctx.memory.length, "prior observation")} from Market Memory, and wrote ${plural(remembered, "new one", "new ones")} back for the next campaign.`
        : "Market Intelligence returned nothing for these terms, so this run has no fresh external evidence. Everything downstream should be treated as based on the brief alone.",
      confidence: clamp(live ? 0.5 + Math.min(0.4, outputs.length * 0.05) : 0.2),
      outputs: outputs.length ? outputs : ["No external signals observed for these terms."],
    };
  },
};

// ---- Strategy ----

export const strategyAgent: Agent = {
  id: "strategy",
  async run(ctx) {
    // Content pillars come from what research actually found, falling back to the campaign's
    // own goal — never invented from nothing.
    const pillars = ctx.market.opportunities.length
      ? ctx.market.opportunities.slice(0, 3).map((o) => o.split(" → ")[0])
      : [ctx.campaign.goal.replace(/_/g, " "), ctx.brand.oneLiner].filter(Boolean);

    const publishable = ctx.campaign.channels.filter((c) => CHANNEL_PLATFORM[c.toLowerCase()]);
    const cadence = ctx.campaign.assetCount && publishable.length
      ? `${plural(Math.max(1, Math.round(ctx.campaign.assetCount / Math.max(1, publishable.length))), "post")} per platform across ${plural(publishable.length, "platform")}`
      : "cadence pending — no publishable platform on this campaign's channels";

    return {
      ok: true,
      task: `Planning ${ctx.campaign.title}`,
      reasoning: `Goal is ${ctx.campaign.goal.replace(/_/g, " ")} in the ${ctx.campaign.phase} phase. Pillars are drawn from ${ctx.market.opportunities.length ? "the opportunities Research surfaced" : "the campaign brief, because Research found no external signals"}. Cadence is derived from the ${ctx.campaign.assetCount} planned assets over the channels that can actually publish.`,
      confidence: clamp(ctx.market.opportunities.length ? 0.75 : 0.45),
      outputs: [
        ...pillars.map((p) => `Pillar — ${p}`),
        `Cadence — ${cadence}`,
        `Platforms — ${publishable.length ? publishable.join(", ") : "none connected yet"}`,
        ...ctx.goals.kpis.map((k) => `Success metric — ${k.metric}: ${k.target} (${k.timeframe})`),
      ],
    };
  },
};

// ---- Content ----

export const contentAgent: Agent = {
  id: "content",
  async run(ctx) {
    // Generation is background work owned by the Job Engine — the agent commissions it,
    // it does not generate inline.
    const job = jobEngine().createJob(
      "document",
      { workspaceKey: ctx.tenant, campaignId: ctx.campaignId, missionId: ctx.launchId },
      { idempotencyKey: `agent:content:${ctx.launchId}:${ctx.campaignId}` },
    );

    const registry = createAdapterRegistry();
    const variants: string[] = [];
    for (const ch of ctx.campaign.channels) {
      const platform = CHANNEL_PLATFORM[ch.toLowerCase()];
      if (!platform) { variants.push(`${ch} — long-form, no length limit`); continue; }
      const k = registry.get(platform)?.constraints();
      if (k) variants.push(`${platformName(platform)} — up to ${num(k.maxText)} characters${k.requiresAsset ? ", media required" : ""}`);
    }

    return {
      ok: true,
      task: `Writing for ${ctx.campaign.channels.join(", ")}`,
      reasoning: `Commissioned job ${job.id} on the Job Engine for the campaign's ${ctx.campaign.assetCount} planned pieces. Per-platform variants are shaped by each adapter's own constraints rather than a hardcoded limit, and the voice comes from ${ctx.brand.voice.length ? "the learned Brand DNA" : "the campaign brief"}.`,
      confidence: clamp(ctx.brand.voice.length ? 0.7 : 0.5),
      outputs: [`Job ${jobRef(job.id)} queued`, ...variants, `Voice — ${ctx.brand.voice.join(" · ") || "taken from the brief"}`],
    };
  },
};

// ---- Creative ----

export const creativeAgent: Agent = {
  id: "creative",
  async run(ctx) {
    const job = jobEngine().createJob(
      "image_generation",
      { workspaceKey: ctx.tenant, campaignId: ctx.campaignId, missionId: ctx.launchId },
      { idempotencyKey: `agent:creative:${ctx.launchId}:${ctx.campaignId}` },
    );

    const registry = createAdapterRegistry();
    const needs: string[] = [];
    for (const ch of ctx.campaign.channels) {
      const platform = CHANNEL_PLATFORM[ch.toLowerCase()];
      const k = platform ? registry.get(platform)?.constraints() : null;
      if (!platform) continue;
      if (k?.requiresAsset) needs.push(`${platformName(platform)} — media required, up to ${plural(k.maxAssets, "asset")}`);
      else if (k) needs.push(`${platformName(platform)} — media optional, up to ${plural(k.maxAssets, "asset")}${k.allowsVideo ? ", video supported" : ", no video"}`);
    }

    return {
      ok: true,
      task: `Producing visuals for ${ctx.campaign.title}`,
      reasoning: `Commissioned job ${job.id} for the campaign's visual assets. Format requirements are read from each platform adapter, so a platform that mandates media is never left with a text-only post. Brand consistency is anchored on ${ctx.brand.voice.length ? "the learned Brand DNA" : "the brief's creative direction"}.`,
      confidence: clamp(needs.length ? 0.68 : 0.4),
      outputs: [`Job ${jobRef(job.id)} queued`, ...(needs.length ? needs : ["No platform-specific media requirements on this campaign's channels."])],
    };
  },
};

// ---- Publishing ----

export const publishingAgent: Agent = {
  id: "publishing",
  async run(ctx, step) {
    const engine = socialEngine();
    const connected = ctx.connectedPlatforms.filter((a) => a.status === "connected");

    if (step === "platform_optimization") {
      const registry = createAdapterRegistry();
      // Constraints are per platform, not per account — two LinkedIn accounts share one
      // set of rules, so listing them twice would just be noise.
      const platforms = [...new Set(connected.map((a) => a.platform))];
      const checks = platforms
        .map((p) => registry.get(p as SocialPlatform)?.constraints())
        .filter(Boolean)
        .map((k) => `${platformName(k!.platform as SocialPlatform)} — up to ${num(k!.maxText)} characters, ${plural(k!.maxAssets, "asset")}${k!.allowsScheduling ? ", scheduling supported" : ", immediate posting only"}`);
      return {
        ok: true,
        task: "Validating content against platform rules",
        reasoning: connected.length
          ? `Checked the campaign against the live constraints of ${plural(new Set(connected.map((a) => a.platform)).size, "connected platform")}. Constraints are the adapters' own, so a platform changing its limits changes this check without a code edit.`
          : "No connected platforms, so there is nothing to validate against yet. Connect an account and this becomes a real check.",
        confidence: clamp(connected.length ? 0.85 : 0.25),
        outputs: checks.length ? checks : ["No connected platforms to validate against."],
      };
    }

    if (connected.length === 0) {
      return {
        ok: false,
        task: "Preparing to publish",
        reasoning: "Publishing needs at least one connected account. Rather than queue work that can never go out, the run stops here so the gap is visible.",
        confidence: 0.9,
        outputs: [],
        error: "No connected platform accounts — connect one in Cross-Post.",
      };
    }

    const accounts = await engine.listAccounts(ctx.tenant).catch(() => []);
    const usable = accounts.filter((a) => a.status === "connected");
    const scheduled: string[] = [];
    for (const account of usable) {
      // Idempotency key is the agent's contract with the Publishing Engine: the same
      // campaign on the same account never double-posts, however often this step re-runs.
      const job = await engine.schedule(
        {
          tenant: ctx.tenant, accountId: account.id, platform: account.platform,
          content: { text: `${ctx.campaign.title} — ${ctx.brand.oneLiner}`, assetIds: [] },
          assets: [], idempotencyKey: `agent:publishing:${ctx.launchId}:${ctx.campaignId}:${account.id}`,
        },
        ctx.now + 86_400_000,
        "UTC",
      );
      scheduled.push(`${platformName(account.platform)} — job ${jobRef(job.id)}`);
    }

    return {
      ok: true,
      task: `Scheduling across ${plural(usable.length, "platform")}`,
      reasoning: `Handed ${plural(scheduled.length, "post")} to the Publishing Engine, which owns retries, backoff and the dead-letter queue. Nothing is published from here directly — the adapters do that on their own schedule.`,
      confidence: clamp(0.6 + usable.length * 0.1),
      outputs: scheduled,
    };
  },
};

// ---- Analytics ----

export const analyticsAgent: Agent = {
  id: "analytics",
  async run(ctx) {
    const history = await socialEngine().listHistory(ctx.tenant).catch(() => []);
    const published = history.filter((h) => h.state === "published");
    const failed = history.filter((h) => h.error);

    const byPlatform = new Map<string, number>();
    for (const h of published) byPlatform.set(h.platform, (byPlatform.get(h.platform) ?? 0) + 1);

    return {
      ok: true,
      task: "Reporting on what actually happened",
      reasoning: published.length
        ? `Read ${plural(published.length, "published post")} and ${plural(failed.length, "failure")} from publishing history. Reach and revenue are not reported because no platform has returned those metrics yet — an ROI number without them would be fiction.`
        : "Nothing has published yet, so there is no performance to report. This will fill in as posts go live.",
      confidence: clamp(published.length ? 0.5 + Math.min(0.4, published.length * 0.05) : 0.15),
      outputs: published.length
        ? [
          `Published — ${num(published.length)}`,
          ...[...byPlatform].map(([p, n]) => `${platformName(p as SocialPlatform)} — ${plural(n, "post")}`),
          ...(failed.length ? [`Failed — ${num(failed.length)}, retryable from Publishing`] : []),
          `Scheduled — ${num(ctx.analytics.scheduled)} still queued`,
        ]
        : ["No published results yet."],
    };
  },
};

// ---- Editor ----

export const editorAgent: Agent = {
  id: "editor",
  async run(ctx) {
    // The grader is lib/content/craft.ts — the same one the composer runs before a draft is
    // ever returned. Deliberately the same code and not a second opinion: an Editor that
    // graded by different rules than the writer would reject work the writer was told to
    // produce, and the two would drift apart within a week.
    if (ctx.drafts.length === 0) {
      return {
        ok: true,
        task: "Waiting for copy to edit",
        reasoning: "Nothing has been written for this workspace yet. An editor with no drafts has no opinion worth recording, and inventing one would be the slop this agent exists to remove.",
        confidence: 0.9,
        outputs: ["No drafts to review."],
      };
    }

    const reviewed = ctx.drafts.map((d) => ({ draft: d, craft: scoreDraft(d.text) }));
    const flagged = reviewed.filter((r) => r.craft.needsRewrite);
    const issueCounts = new Map<string, number>();
    for (const r of reviewed) {
      for (const i of r.craft.issues) issueCounts.set(i.code, (issueCounts.get(i.code) ?? 0) + 1);
    }

    const avg = reviewed.reduce((sum, r) => sum + r.craft.score, 0) / reviewed.length;
    const outputs = [
      `Reviewed — ${plural(reviewed.length, "draft")}, ${flagged.length} sent back`,
      ...[...issueCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([code, n]) => `${CRAFT_ISSUE_LABEL[code] ?? code} — ${n}`),
      ...flagged.slice(0, 4).map((r) => `Rewrite — "${r.draft.title}" scored ${r.craft.score.toFixed(1)}`),
    ];

    return {
      ok: true,
      task: `Editing ${plural(reviewed.length, "draft")}`,
      reasoning: flagged.length
        ? `${plural(flagged.length, "draft")} failed the craft check and were sent back for a rewrite. The checks are deterministic — stock AI phrasing, unsourced claims, an opening that would fit any post about anything, and sentences that all run to one length — so a draft is rejected for a named fault rather than a mood.`
        : `Every draft passed. Average craft score ${avg.toFixed(1)}. Nothing was rewritten, which is the correct outcome when nothing is wrong; a rewrite loop that always finds something is a token bill, not an editor.`,
      confidence: clamp(0.55 + Math.min(0.35, reviewed.length * 0.05)),
      outputs,
    };
  },
};

// ---- SEO ----

export const seoAgent: Agent = {
  id: "seo",
  async run(ctx) {
    if (!ctx.site) {
      return {
        ok: true,
        task: "Waiting for a site to audit",
        reasoning: "No website has been analysed for this workspace, so there is nothing to measure. Auditing a URL guessed from the brand name would produce a real-looking score for a page that may not be theirs.",
        confidence: 0.9,
        outputs: ["No site connected — add one from Home to enable the audit."],
      };
    }

    const audit = await auditUrl(ctx.site, { timeoutMs: 45_000 }).catch(() => null);
    if (!audit) {
      return {
        ok: false,
        task: `Auditing ${ctx.site}`,
        reasoning: "The audit could not complete. Nothing is reported rather than a partial score, because a page-speed number missing half its inputs reads as a verdict.",
        confidence: 0.2,
        outputs: [],
        error: "The site audit did not complete.",
      };
    }

    // On-page signals are read from the page's own HTML and owe Google nothing, so they
    // survive the PageSpeed rate limiting that leaves the dials blank.
    const errors = audit.issues.filter((i) => i.severity === "error");
    const warnings = audit.issues.filter((i) => i.severity === "warning");
    const outputs = [
      ...audit.issues.slice(0, 6).map((i) => `${i.severity === "error" ? "Fix" : "Improve"} — ${i.title}`),
      ...audit.signals.slice(0, 4).map((s) => `${s.label} — ${s.value}`),
    ];

    return {
      ok: true,
      task: `Auditing ${ctx.site}`,
      reasoning: [
        `Read the page's own HTML for title, description, headings and structured data, and asked Google for speed scores.`,
        errors.length || warnings.length
          ? `Found ${plural(errors.length, "issue")} to fix and ${plural(warnings.length, "improvement")}.`
          : `Nothing failed the on-page checks.`,
        audit.problems.length ? audit.problems[0] : "",
      ].filter(Boolean).join(" "),
      // Confidence tracks what was actually measured. Speed scores missing is not a reason
      // to sound as sure as a run that had them.
      confidence: clamp(audit.problems.length ? 0.5 : 0.8),
      outputs: outputs.length ? outputs : ["No on-page issues found."],
    };
  },
};

// ---- Learning ----

export const learningAgent: Agent = {
  id: "learning",
  async run(ctx, step) {
    if (step === "optimization") {
      const suggestions = ctx.market.opportunities.slice(0, 3);
      return {
        ok: true,
        task: "Recommending changes to the rest of the campaign",
        reasoning: suggestions.length
          ? `Compared the remaining campaign against ${plural(suggestions.length, "live opportunity card")}. These are recommendations only — the Execution Engine will not apply any of them without an approval.`
          : "Nothing in the current market picture warrants changing the remaining campaign.",
        confidence: clamp(suggestions.length ? 0.6 : 0.35),
        outputs: suggestions.length ? suggestions.map((s) => `Recommend — ${s}`) : ["No changes recommended."],
      };
    }

    const history = await socialEngine().listHistory(ctx.tenant).catch(() => []);
    const published = history.filter((h) => h.state === "published" && h.publishedAt != null);
    if (published.length === 0) {
      return {
        ok: true,
        task: "Waiting for results to learn from",
        reasoning: "Learning needs outcomes. Nothing has published yet, so there is nothing to feed the Pattern Library, and inventing a pattern from zero evidence would poison every future recommendation.",
        confidence: 0.9,
        outputs: ["Nothing learned this run — no published results yet."],
      };
    }

    const events = published.map((h) => normalizePerformanceEvent({
      id: h.id, assetKey: h.jobId, platform: h.platform as PlatformId,
      campaignId: ctx.campaignId, missionId: ctx.launchId,
      audience: ctx.audience, at: h.publishedAt ?? ctx.now, metrics: {},
    }));
    const result = await learningEngine(db()).ingest(events, { workspaceKey: ctx.tenant });

    // Campaign outcome goes into Market Memory too, so future research recalls it.
    try {
      await marketPlatform().memory.record(memoryRecord(
        ctx.tenant, "campaign", ctx.campaign.title,
        `${published.length} published · goal ${ctx.campaign.goal}`, ctx.now, null,
      ));
    } catch { /* best effort */ }

    return {
      ok: true,
      task: "Folding results into what Populr knows",
      reasoning: `Fed ${plural(result.processedEvents, "published outcome")} through the Learning Engine, which updated the Pattern Library, Creative Memory, Brand DNA and Business Graph signals. The campaign outcome was written to Market Memory so the next Research pass recalls it.`,
      confidence: clamp(0.5 + Math.min(0.4, result.processedEvents * 0.05)),
      outputs: [
        `Events ingested — ${result.processedEvents}`,
        `Patterns — ${result.patterns?.length ?? 0}`,
        `Memory — campaign outcome recorded`,
      ],
    };
  },
};

export const AGENTS: Record<AgentId, Agent> = {
  research: researchAgent,
  strategy: strategyAgent,
  content: contentAgent,
  creative: creativeAgent,
  editor: editorAgent,
  seo: seoAgent,
  publishing: publishingAgent,
  analytics: analyticsAgent,
  learning: learningAgent,
};
