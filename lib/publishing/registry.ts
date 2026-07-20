import type { PlatformId, ProviderHealth, PublishingProvider } from "./types";
import { createReferenceProviders } from "./providers";

// Publishing Provider Registry — register platform adapters, look them up by platform,
// report health. Adapters are interchangeable; the router only ever asks the registry.
export class PublishingProviderRegistry {
  private providers = new Map<PlatformId, PublishingProvider>();

  register(provider: PublishingProvider): this {
    this.providers.set(provider.platform, provider);
    return this;
  }

  get(platform: PlatformId): PublishingProvider | null {
    return this.providers.get(platform) ?? null;
  }

  has(platform: PlatformId): boolean {
    return this.providers.has(platform);
  }

  list(): PublishingProvider[] {
    return [...this.providers.values()];
  }

  platforms(): PlatformId[] {
    return [...this.providers.keys()];
  }

  async health(): Promise<ProviderHealth[]> {
    return Promise.all(this.list().map((p) => p.health()));
  }
}

/** A registry preloaded with the reference providers (one per platform). */
export function createDefaultRegistry(now: () => number = () => 0): PublishingProviderRegistry {
  const reg = new PublishingProviderRegistry();
  for (const p of createReferenceProviders(now)) reg.register(p);
  return reg;
}

let shared: PublishingProviderRegistry | null = null;
export function getPublishingRegistry(): PublishingProviderRegistry {
  if (!shared) shared = createDefaultRegistry();
  return shared;
}
