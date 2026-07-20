import type { AssetKind } from "@/lib/creative/taxonomy";
import {
  PLATFORMS, type PlatformId, type ProviderHealth, type PublishingProvider,
  type PublishResult, type PublishTarget,
} from "./types";

// Reference publishing providers — vendor-neutral platform ADAPTERS. They carry NO
// business logic: they just translate a normalized PublishTarget into a (simulated)
// platform call and return a provider-independent result. Real adapters (LinkedIn API,
// etc.) implement the same interface and drop in without touching the router or engine.

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Base adapter: deterministic, no network. Subclasses set platform + rate limit. */
class ReferenceProvider implements PublishingProvider {
  constructor(
    readonly platform: PlatformId,
    private rateLimitPerMin: number,
    readonly version = "ref-1",
    private now: () => number = () => 0,
  ) {}

  private ref(kind: string, target: PublishTarget): string {
    return `populr://${kind}/${this.platform}/${hash(target.assetKey + target.content).slice(0, 10)}`;
  }

  async publish(target: PublishTarget): Promise<PublishResult> {
    const externalId = hash(this.platform + target.assetKey);
    return {
      ok: true, assetKey: target.assetKey, platform: this.platform, status: "published",
      publishedUrl: this.ref("published", target), previewUrl: this.ref("preview", target),
      externalId, at: this.now(),
    };
  }

  async schedule(target: PublishTarget): Promise<PublishResult> {
    const externalId = hash(this.platform + target.assetKey + "sched");
    return {
      ok: true, assetKey: target.assetKey, platform: this.platform, status: "scheduled",
      previewUrl: this.ref("preview", target), externalId, at: this.now(),
    };
  }

  async delete(externalId: string) {
    return { ok: !!externalId };
  }

  async update(externalId: string, target: PublishTarget): Promise<PublishResult> {
    return {
      ok: true, assetKey: target.assetKey, platform: this.platform, status: "published",
      publishedUrl: this.ref("published", target), externalId, at: this.now(),
    };
  }

  async status(externalId: string): Promise<PublishResult> {
    return { ok: true, assetKey: externalId, platform: this.platform, status: "published", at: this.now() };
  }

  async preview(target: PublishTarget) {
    return { previewUrl: this.ref("preview", target) };
  }

  async health(): Promise<ProviderHealth> {
    return { platform: this.platform, healthy: true, rateLimitPerMin: this.rateLimitPerMin };
  }
}

// Per-platform rate limits (posts/min) — abstract, used by the router's limiter.
const RATE_LIMITS: Record<PlatformId, number> = {
  linkedin: 5, x: 15, instagram: 6, facebook: 10, tiktok: 4, youtube: 2, email: 30, website: 60, cms: 60,
};

/** Construct the default set of reference providers, one per platform. */
export function createReferenceProviders(now: () => number = () => 0): PublishingProvider[] {
  return PLATFORMS.map((p) => new ReferenceProvider(p, RATE_LIMITS[p], "ref-1", now));
}

// ---- Channel / asset-kind → platform routing (no vendor names, pure mapping) ----

const CHANNEL_TO_PLATFORM: Record<string, PlatformId> = {
  linkedin: "linkedin", x: "x", instagram: "instagram", reddit: "website",
  articles: "website", seo: "website", geo: "website", hn: "website",
  email: "email", ads: "facebook", video: "youtube", landing: "website", docs: "cms",
};

const KIND_TO_PLATFORM: Partial<Record<AssetKind, PlatformId>> = {
  hero_video: "youtube", product_demo: "youtube", ugc_video: "tiktok", motion_graphic: "youtube",
  landing_hero: "website", linkedin_post: "linkedin", x_thread: "x", reddit_post: "website",
  email: "email", carousel: "instagram", instagram_post: "instagram", blog: "website",
  infographic: "instagram", advertisement: "facebook", press_release: "website",
  sales_deck: "cms", case_study: "website",
};

/** Resolve the platform for an asset (kind wins; channel is the fallback). */
export function platformFor(kind: AssetKind, channel?: string): PlatformId {
  return KIND_TO_PLATFORM[kind] ?? (channel ? CHANNEL_TO_PLATFORM[channel] : undefined) ?? "website";
}
