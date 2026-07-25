import { OAuthService } from "./oauth";
import type {
  ConnectionCheck, OAuthToken, PlatformConstraints, PublishRequest, PublishResult,
  SocialAdapter, SocialPlatform,
} from "./types";

// Reference platform adapters. Each implements EXACTLY publish/schedule/delete/
// refreshToken/validateConnection (+ constraints). Deterministic, no vendor SDKs. Real
// adapters implement the same interface and drop in with zero changes to the scheduler,
// queue or workers — which only ever talk to this interface. NO business logic here.

function hash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

const CONSTRAINTS: Record<SocialPlatform, Omit<PlatformConstraints, "platform">> = {
  linkedin:            { maxText: 3000, maxAssets: 9, allowsVideo: true, allowsScheduling: true, requiresAsset: false },
  instagram_business:  { maxText: 2200, maxAssets: 10, allowsVideo: true, allowsScheduling: true, requiresAsset: true },
  facebook_pages:      { maxText: 63206, maxAssets: 10, allowsVideo: true, allowsScheduling: true, requiresAsset: false },
  x:                   { maxText: 280, maxAssets: 4, allowsVideo: true, allowsScheduling: true, requiresAsset: false },
  threads:             { maxText: 500, maxAssets: 10, allowsVideo: true, allowsScheduling: false, requiresAsset: false },
  pinterest:           { maxText: 500, maxAssets: 1, allowsVideo: false, allowsScheduling: true, requiresAsset: true },
};

class ReferenceSocialAdapter implements SocialAdapter {
  private oauth: OAuthService;
  constructor(readonly platform: SocialPlatform, private now: () => number = () => 0) {
    this.oauth = new OAuthService({ now });
  }

  constraints(): PlatformConstraints { return { platform: this.platform, ...CONSTRAINTS[this.platform] }; }

  /** Validate a request against this platform's constraints (adapter owns platform rules). */
  private check(req: PublishRequest): string | null {
    const c = CONSTRAINTS[this.platform];
    if (req.content.text.length > c.maxText) return `text exceeds ${c.maxText} chars`;
    if (req.assets.length > c.maxAssets) return `too many assets (max ${c.maxAssets})`;
    if (c.requiresAsset && req.assets.length === 0) return "at least one media asset is required";
    if (!c.allowsVideo && req.assets.some((a) => a.kind === "video")) return "video is not supported";
    return null;
  }

  async publish(req: PublishRequest, _token: OAuthToken): Promise<PublishResult> {
    const err = this.check(req);
    if (err) return { ok: false, platform: this.platform, error: err, at: this.now() };
    const externalId = hash(`${this.platform}:${req.accountId}:${req.content.text}:${req.assets.map((a) => a.id).join(",")}`);
    return {
      ok: true, platform: this.platform, externalId,
      permalink: `populr://post/${this.platform}/${externalId}`, at: this.now(),
    };
  }

  async schedule(req: PublishRequest, token: OAuthToken, at: number): Promise<PublishResult> {
    if (!CONSTRAINTS[this.platform].allowsScheduling) {
      return { ok: false, platform: this.platform, error: "native scheduling not supported — Populr will dispatch at time", at };
    }
    const err = this.check(req);
    if (err) return { ok: false, platform: this.platform, error: err, at };
    const externalId = hash(`sched:${this.platform}:${req.accountId}:${at}`);
    return { ok: true, platform: this.platform, externalId, permalink: `populr://scheduled/${this.platform}/${externalId}`, at };
  }

  async delete(externalId: string, _token: OAuthToken): Promise<{ ok: boolean; error?: string }> {
    return { ok: !!externalId };
  }

  async refreshToken(token: OAuthToken): Promise<OAuthToken> { return this.oauth.refresh(token); }

  async validateConnection(token: OAuthToken): Promise<ConnectionCheck> {
    if (!token.accessToken) return { ok: false, status: "disconnected" };
    if (token.expiresAt != null && token.expiresAt <= this.now()) return { ok: false, status: "expired", detail: "token expired" };
    return { ok: true, status: "connected" };
  }
}

/** All reference adapters, keyed by platform. */
export function createReferenceAdapters(now: () => number = () => 0): Record<SocialPlatform, SocialAdapter> {
  const out = {} as Record<SocialPlatform, SocialAdapter>;
  for (const p of Object.keys(CONSTRAINTS) as SocialPlatform[]) out[p] = new ReferenceSocialAdapter(p, now);
  return out;
}

export { CONSTRAINTS };
