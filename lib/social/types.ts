// Cross-Platform Publishing System — types. A modular publishing layer over social
// platforms. Adapters own all platform specifics; the scheduler, queue and workers are
// platform-agnostic and execute jobs THROUGH adapters only. Additive to the existing
// Publishing Engine (M9) and Connector Platform (M12) — nothing is redesigned.

// Publishing priority order.
export const SOCIAL_PLATFORMS = [
  "linkedin", "instagram_business", "facebook_pages", "x", "threads", "pinterest",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

// ---- Assets (multiple per post) ----

export type AssetKindMedia = "image" | "video" | "gif" | "document";
export type Asset = {
  id: string;
  kind: AssetKindMedia;
  /** Opaque, provider-independent locator (populr://media/...). Never a vendor URL. */
  uri: string;
  mime: string;
  altText?: string;
  width?: number;
  height?: number;
};

// ---- Connected accounts + credentials ----

export type ConnectionStatus = "connected" | "disconnected" | "expired" | "error";

export type ConnectedAccount = {
  id: string;
  tenant: string;
  platform: SocialPlatform;
  handle: string;            // @name or page name
  externalId: string;        // provider account/page id
  status: ConnectionStatus;
  scopes: string[];
  connectedAt: number;
  tokenExpiresAt: number | null;
};

/** Encrypted credential row — the raw token is never stored or returned in plaintext. */
export type IntegrationCredential = {
  accountId: string;
  platform: SocialPlatform;
  /** AES-encrypted token bundle (access + refresh). */
  ciphertext: string;
  iv: string;
  tag: string;
  expiresAt: number | null;
};

export type OAuthToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  scopes: string[];
  externalId: string;
  handle: string;
};

// ---- Content: drafts, requests, jobs, scheduled posts ----

export type PostContent = {
  text: string;
  assetIds: string[];
  linkUrl?: string;
  firstComment?: string;     // e.g. LinkedIn first comment
};

export type Draft = {
  id: string;
  tenant: string;
  title: string;
  platforms: SocialPlatform[];
  content: PostContent;
  createdAt: number;
  updatedAt: number;
};

export type PublishRequest = {
  tenant: string;
  accountId: string;
  platform: SocialPlatform;
  content: PostContent;
  assets: Asset[];
  /** Idempotency key — the same key never publishes twice. */
  idempotencyKey?: string;
};

export type PublishResult = {
  ok: boolean;
  platform: SocialPlatform;
  externalId?: string;       // provider post id
  permalink?: string;        // provider-neutral locator
  error?: string;
  at: number;
};

export type JobState = "queued" | "scheduled" | "publishing" | "published" | "failed" | "cancelled" | "dead_letter";

export type PublishJob = {
  id: string;
  tenant: string;
  accountId: string;
  platform: SocialPlatform;
  content: PostContent;
  assets: Asset[];
  state: JobState;
  attempts: number;
  maxRetries: number;
  /** Epoch ms to publish at (null = now). */
  scheduledAt: number | null;
  /** IANA timezone the schedule was expressed in (for display + DST correctness). */
  timezone: string | null;
  nextAttemptAt: number | null;   // exponential backoff
  idempotencyKey: string | null;
  result: PublishResult | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  logs: JobLog[];
};

export type JobLog = { at: number; level: "info" | "warn" | "error"; message: string };

export type PublishHistoryEntry = {
  id: string;
  tenant: string;
  jobId: string;
  accountId: string;
  platform: SocialPlatform;
  state: JobState;
  externalId: string | null;
  permalink: string | null;
  attempts: number;
  publishedAt: number | null;
  error: string | null;
};

// ---- Adapter interface (each platform implements exactly these) ----

export type ConnectionCheck = { ok: boolean; status: ConnectionStatus; detail?: string };

export interface SocialAdapter {
  readonly platform: SocialPlatform;
  publish(req: PublishRequest, token: OAuthToken): Promise<PublishResult>;
  schedule(req: PublishRequest, token: OAuthToken, at: number): Promise<PublishResult>;
  delete(externalId: string, token: OAuthToken): Promise<{ ok: boolean; error?: string }>;
  refreshToken(token: OAuthToken): Promise<OAuthToken>;
  validateConnection(token: OAuthToken): Promise<ConnectionCheck>;
  /** Platform posting constraints, so the scheduler/UI can validate without platform code. */
  constraints(): PlatformConstraints;
}

export type PlatformConstraints = {
  platform: SocialPlatform;
  maxText: number;
  maxAssets: number;
  allowsVideo: boolean;
  allowsScheduling: boolean;
  requiresAsset: boolean;    // e.g. Instagram/Pinterest require media
};

// ---- Monitoring ----

export type QueueMetrics = {
  queued: number;
  scheduled: number;
  publishing: number;
  published: number;
  failed: number;
  deadLetter: number;
  retrying: number;
  avgAttempts: number;
};
