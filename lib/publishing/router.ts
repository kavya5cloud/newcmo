import type { PublishingProviderRegistry } from "./registry";
import type { PublishRecord, PublishResult, PublishTarget, PlatformId } from "./types";
import { EventBus } from "./events";

// Publishing Router — selects a provider for a target's platform, handles retries,
// fallback, rate limiting and status tracking, and emits progress events. It owns the
// retry/publishing QUEUE; providers stay dumb. No business logic about WHAT to publish.

export type RouterOptions = {
  now?: () => number;
  maxRetries?: number;
  /** Deterministic failure injection for tests: return true to fail an attempt. */
  shouldFail?: (platform: PlatformId, attempt: number) => boolean;
  bus?: EventBus;
  /** When the primary platform has no provider or keeps failing, fall back here. */
  fallbackPlatform?: PlatformId;
};

export type RouteResult = PublishResult & { attempts: number; failures: number; provider: string; fellBack: boolean };

export class PublishingRouter {
  readonly bus: EventBus;
  private now: () => number;
  private maxRetries: number;
  private shouldFail?: RouterOptions["shouldFail"];
  private fallbackPlatform: PlatformId;
  private records: PublishRecord[] = [];
  private limiter = new Map<PlatformId, number>();

  constructor(private registry: PublishingProviderRegistry, opts: RouterOptions = {}) {
    this.now = opts.now ?? (() => 0);
    this.maxRetries = opts.maxRetries ?? 2;
    this.shouldFail = opts.shouldFail;
    this.fallbackPlatform = opts.fallbackPlatform ?? "website";
    this.bus = opts.bus ?? new EventBus();
  }

  history(): PublishRecord[] { return [...this.records]; }

  /** Simple per-platform rate limiter. Returns true if the platform is over budget. */
  private async rateLimited(platform: PlatformId): Promise<boolean> {
    const provider = this.registry.get(platform);
    if (!provider) return false;
    const limit = (await provider.health()).rateLimitPerMin;
    const used = (this.limiter.get(platform) ?? 0) + 1;
    this.limiter.set(platform, used);
    return used > limit;
  }
  resetLimiter() { this.limiter.clear(); }

  /** Publish a target with retries + fallback. Records history and emits events. */
  async publish(target: PublishTarget): Promise<RouteResult> {
    let platform = target.platform;
    let provider = this.registry.get(platform) ?? this.registry.get(this.fallbackPlatform);
    let fellBack = provider?.platform !== platform;
    if (provider) platform = provider.platform;

    if (!provider) {
      this.record(target, "failed", 1, 1, false);
      this.bus.emit({ type: "asset.failed", assetKey: target.assetKey, platform, at: this.now(), data: { error: "no_provider" } });
      return { ...failResult(target, platform, "no_provider", this.now()), attempts: 1, failures: 1, provider: "none", fellBack };
    }

    if (await this.rateLimited(platform)) {
      this.bus.emit({ type: "asset.scheduled", assetKey: target.assetKey, platform, at: this.now(), data: { reason: "rate_limited" } });
      return { ok: false, assetKey: target.assetKey, platform, status: "queued", at: this.now(), attempts: 0, failures: 0, provider: provider.version, fellBack, error: "rate_limited" };
    }

    let attempts = 0;
    let failures = 0;
    this.bus.emit({ type: "asset.publishing", assetKey: target.assetKey, platform, at: this.now() });

    while (attempts <= this.maxRetries) {
      attempts += 1;
      const fail = this.shouldFail?.(platform, attempts) ?? false;
      if (!fail) {
        const result = await provider.publish(target);
        this.record(target, "published", attempts, failures, false, result);
        this.bus.emit({ type: "asset.published", assetKey: target.assetKey, platform, at: this.now(), data: { url: result.publishedUrl } });
        return { ...result, attempts, failures, provider: provider.version, fellBack };
      }
      failures += 1;
      this.bus.emit({ type: "asset.retried", assetKey: target.assetKey, platform, at: this.now(), data: { attempt: attempts } });
    }

    // Exhausted retries on the primary — try the fallback provider once (if different).
    const fb = this.registry.get(this.fallbackPlatform);
    if (fb && fb.platform !== platform) {
      const result = await fb.publish(target);
      this.record(target, "published", attempts + 1, failures, false, result);
      this.bus.emit({ type: "asset.published", assetKey: target.assetKey, platform: fb.platform, at: this.now(), data: { url: result.publishedUrl, fellBack: true } });
      return { ...result, attempts: attempts + 1, failures, provider: fb.version, fellBack: true };
    }

    this.record(target, "failed", attempts, failures, false);
    this.bus.emit({ type: "asset.failed", assetKey: target.assetKey, platform, at: this.now(), data: { failures } });
    return { ...failResult(target, platform, "publish_failed", this.now()), attempts, failures, provider: provider.version, fellBack };
  }

  /** Schedule a target for a future time via its provider. */
  async schedule(target: PublishTarget): Promise<RouteResult> {
    const provider = this.registry.get(target.platform) ?? this.registry.get(this.fallbackPlatform);
    if (!provider) return { ...failResult(target, target.platform, "no_provider", this.now()), attempts: 0, failures: 0, provider: "none", fellBack: true };
    const result = await provider.schedule(target);
    this.record(target, "scheduled", 1, 0, false, result);
    this.bus.emit({ type: "asset.scheduled", assetKey: target.assetKey, platform: provider.platform, at: this.now() });
    return { ...result, attempts: 1, failures: 0, provider: provider.version, fellBack: provider.platform !== target.platform };
  }

  /** Publish many targets (bulk). Sequential + deterministic. */
  async publishBatch(targets: PublishTarget[]): Promise<RouteResult[]> {
    const out: RouteResult[] = [];
    for (const t of targets) out.push(await this.publish(t));
    return out;
  }

  private record(
    target: PublishTarget, status: PublishRecord["status"], retries: number, failures: number,
    rolledBack: boolean, result?: PublishResult,
  ): PublishRecord {
    const rec: PublishRecord = {
      id: `${target.platform}:${target.assetKey}:${this.records.length}`,
      assetKey: target.assetKey, platform: target.platform,
      provider: result ? "ref-1" : "none", version: 1, at: this.now(),
      retries, failures, rolledBack,
      publishedUrl: result?.publishedUrl ?? null, previewUrl: result?.previewUrl ?? null,
      status, metrics: null,
    };
    this.records.push(rec);
    return rec;
  }
}

function failResult(target: PublishTarget, platform: PlatformId, error: string, at: number): PublishResult {
  return { ok: false, assetKey: target.assetKey, platform, status: "failed", error, at };
}
