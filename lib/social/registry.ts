import { createReferenceAdapters } from "./adapters";
import { createLiveAdapters } from "./adapters-live";
import { SOCIAL_PLATFORMS, type SocialAdapter, type SocialPlatform } from "./types";

// Adapter Registry — the ONLY way the scheduler/queue/workers reach a platform. Register,
// look up by platform. Adapters are interchangeable.
export class AdapterRegistry {
  private adapters = new Map<SocialPlatform, SocialAdapter>();
  register(a: SocialAdapter): this { this.adapters.set(a.platform, a); return this; }
  get(platform: SocialPlatform): SocialAdapter | null { return this.adapters.get(platform) ?? null; }
  has(platform: SocialPlatform): boolean { return this.adapters.has(platform); }
  platforms(): SocialPlatform[] { return [...this.adapters.keys()]; }
  list(): SocialAdapter[] { return [...this.adapters.values()]; }
}

/**
 * Every platform gets an adapter. A platform with app credentials configured gets the live
 * one that talks to the real provider; everything else keeps the reference adapter, so an
 * unconfigured environment behaves exactly as it did before.
 *
 * Live adapters are registered second so they overwrite the reference entry for the same
 * platform — registration is last-write-wins by design.
 *
 * Note the clock: the default `() => 0` suits callers that only read constraints. The
 * Publishing Engine passes a real clock, and it is the only caller that publishes.
 */
export function createAdapterRegistry(now: () => number = () => 0): AdapterRegistry {
  const reg = new AdapterRegistry();
  const adapters = createReferenceAdapters(now);
  for (const p of SOCIAL_PLATFORMS) reg.register(adapters[p]);

  for (const adapter of Object.values(createLiveAdapters(now))) {
    if (adapter) reg.register(adapter);
  }
  return reg;
}

/** Which platforms currently reach the real provider. The UI uses this to avoid implying
 *  that a reference-mode connection publishes anywhere. */
export function liveAdapterPlatforms(): SocialPlatform[] {
  return Object.keys(createLiveAdapters()) as SocialPlatform[];
}
