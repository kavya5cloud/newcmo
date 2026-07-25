import { createReferenceAdapters } from "./adapters";
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

export function createAdapterRegistry(now: () => number = () => 0): AdapterRegistry {
  const reg = new AdapterRegistry();
  const adapters = createReferenceAdapters(now);
  for (const p of SOCIAL_PLATFORMS) reg.register(adapters[p]);
  return reg;
}
