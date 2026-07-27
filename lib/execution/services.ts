import { jobEngine } from "@/lib/jobs/shared";
import { learningEngine } from "@/lib/learning/shared";
import { normalizePerformanceEvent } from "@/lib/learning/performance";
import { marketPlatform } from "@/lib/market/shared";
import { socialEngine } from "@/lib/social/shared";
import { createAdapterRegistry } from "@/lib/social/registry";
import { db } from "@/lib/db";
import type { PlatformId } from "@/lib/publishing/types";
import type { ExecutionContext, ExecutionServices, StepOutcome } from "./workflow";

// The real wiring between the execution workflow and the engines that do the work.
//
// Every function here is a thin adapter: read from an existing engine, hand it work, and
// describe what happened. There is no business logic in this file, by design — if a rule
// belongs to publishing, it lives in the Publishing Engine.

const ok = (note: string, activity?: StepOutcome["activity"]): StepOutcome => ({ ok: true, note, activity });

/** Plan channel names → the publishing platform ids that can serve them. */
const CHANNEL_PLATFORM: Record<string, string> = {
  linkedin: "linkedin", instagram: "instagram_business", facebook: "facebook_pages",
  x: "x", threads: "threads", pinterest: "pinterest",
};

export function liveServices(): ExecutionServices {
  return {
    async research(c) {
      const brief = await marketPlatform().research.run({
        tenant: c.tenant, terms: [c.plan.mission, c.campaign.title], competitors: [],
        industry: "saas", audience: c.campaign.brief.audience,
      });
      return ok(brief.headline || `Researched ${c.campaign.title}`);
    },

    async marketIntelligence(c) {
      const brief = await marketPlatform().research.run({
        tenant: c.tenant, terms: [c.campaign.title], competitors: [],
        industry: "saas", audience: c.campaign.brief.audience,
      });
      const top = brief.opportunities[0];
      const activity = brief.competitors.length
        ? [{ kind: "competitor_detected" as const, message: `Competitor signal: ${brief.competitors[0].summary}` }]
        : undefined;
      return ok(
        top ? `${brief.opportunities.length} opportunities — top: ${top.title}` : "No opportunities detected in this window",
        activity,
      );
    },

    async generate(c, kind) {
      // Generation is background work: the Job Engine owns queueing, retries and progress.
      const job = jobEngine().createJob(
        kind === "asset" ? "image_generation" : "document",
        { workspaceKey: c.tenant, campaignId: c.campaignId, missionId: c.launchId },
        { idempotencyKey: `exec:${c.launchId}:${c.campaignId}:${kind}` },
      );
      return ok(
        `${kind === "asset" ? "Asset" : "Copy"} generation queued (job ${job.id})`,
        [{ kind: kind === "asset" ? "asset_generated" : "copy_rewritten", message: `${c.campaign.title}: ${kind} generation queued` }],
      );
    },

    async optimizeForPlatforms(c) {
      // Constraints come from the platform adapters — the execution layer never hardcodes
      // a character limit that a platform could change tomorrow.
      const registry = createAdapterRegistry();
      const notes: string[] = [];
      for (const ch of c.campaign.channels) {
        const platform = CHANNEL_PLATFORM[ch.toLowerCase()];
        if (!platform) continue;
        const adapter = registry.get(platform as Parameters<typeof registry.get>[0]);
        if (!adapter) continue;
        const k = adapter.constraints();
        notes.push(`${platform}: ≤${k.maxText} chars, ≤${k.maxAssets} assets${k.requiresAsset ? ", media required" : ""}`);
      }
      return ok(notes.length ? notes.join(" · ") : "No publishable platforms on this campaign's channels");
    },

    async publish(c) {
      const engine = socialEngine();
      const accounts = (await engine.listAccounts(c.tenant)).filter((a) => a.status === "connected");
      if (accounts.length === 0) {
        return { ok: false, note: "Nothing published", error: "No connected platform accounts — connect one in Cross-Post." };
      }
      const slots = c.plan.publishingSchedule.filter((s) => s.assetKey.startsWith(`${c.campaignId}:`));
      let scheduled = 0;
      for (const slot of slots) {
        const account = accounts.find((a) => a.platform === CHANNEL_PLATFORM[slot.channel.toLowerCase()]);
        if (!account) continue;
        // Idempotent by construction: the same slot on the same account never double-posts.
        await engine.schedule(
          {
            tenant: c.tenant, accountId: account.id, platform: account.platform,
            content: { text: `${c.campaign.title} — ${slot.kind.replace(/_/g, " ")}`, assetIds: [] },
            assets: [], idempotencyKey: `exec:${c.launchId}:${slot.assetKey}:${account.id}`,
          },
          c.now + slot.dayOffset * 86_400_000,
          "UTC",
        );
        scheduled++;
      }
      return scheduled > 0
        ? ok(`Scheduled ${scheduled} post${scheduled === 1 ? "" : "s"} across ${accounts.length} account${accounts.length === 1 ? "" : "s"}`,
          [{ kind: "queued", message: `${c.campaign.title}: ${scheduled} post(s) queued` }])
        : ok("No slots matched a connected account — nothing was queued");
    },

    async analytics(c) {
      const history = await socialEngine().listHistory(c.tenant);
      const published = history.filter((h) => h.state === "published");
      return ok(
        published.length
          ? `${published.length} published post${published.length === 1 ? "" : "s"} observed`
          : "No published results to measure yet",
        published.length ? [{ kind: "analytics_updated", message: `Analytics updated from ${published.length} published post(s)` }] : undefined,
      );
    },

    async learn(c) {
      const history = await socialEngine().listHistory(c.tenant);
      const published = history.filter((h) => h.state === "published" && h.publishedAt != null);
      if (published.length === 0) return ok("Nothing to learn from yet — no published results");

      // Feed real outcomes into the Learning Engine so the next run is better informed.
      const events = published.map((h) => normalizePerformanceEvent({
        id: h.id, assetKey: h.jobId, platform: h.platform as PlatformId,
        campaignId: c.campaignId, missionId: c.launchId,
        audience: c.campaign.brief.audience, at: h.publishedAt ?? c.now,
        metrics: {},
      }));
      const result = await learningEngine(db()).ingest(events, { workspaceKey: c.tenant });
      return ok(`Learned from ${result.processedEvents} published result${result.processedEvents === 1 ? "" : "s"}`);
    },

    async optimize(c) {
      const brief = await marketPlatform().research.run({
        tenant: c.tenant, terms: [c.plan.mission], competitors: [],
        industry: "saas", audience: c.campaign.brief.audience,
      });
      const n = brief.opportunities.length;
      return ok(
        n ? `${n} adaptation${n === 1 ? "" : "s"} proposed for the rest of the campaign — none applied without approval`
          : "No changes recommended for the rest of the campaign",
        n ? [{ kind: "timeline_optimized", message: `${n} timeline adaptation(s) proposed` }] : undefined,
      );
    },
  };
}
