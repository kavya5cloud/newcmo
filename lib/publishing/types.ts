// Publishing & Growth Execution Layer — types. Platforms are ADAPTERS; the Business
// Graph and Asset Graph stay the source of truth. Providers carry no business logic.
//
// Reuses the Milestone 7 lifecycle (PublishStage / PublishingQueue) and experiment
// engine rather than redefining them.

import type { AssetKind } from "@/lib/creative/taxonomy";
import type { PublishStage } from "@/lib/launch/types";

export type { PublishStage } from "@/lib/launch/types";

// ---- Platforms (adapters) ----

export const PLATFORMS = [
  "linkedin", "x", "instagram", "facebook", "tiktok", "youtube", "email", "website", "cms",
] as const;
export type PlatformId = (typeof PLATFORMS)[number];

/** The normalized instruction a publishing provider receives. No business context. */
export type PublishTarget = {
  assetKey: string;
  platform: PlatformId;
  /** Rendered, ready-to-post content (text/caption/body). Media is referenced, never inline. */
  content: string;
  mediaRefs?: string[];       // opaque asset-graph/media ids
  title?: string;
  /** Epoch ms to publish at; omitted = publish now. */
  scheduledAt?: number;
  metadata?: Record<string, unknown>;
};

export type PublishStatus = "queued" | "scheduled" | "publishing" | "published" | "failed" | "deleted";

export type PublishResult = {
  ok: boolean;
  assetKey: string;
  platform: PlatformId;
  status: PublishStatus;
  /** Opaque, provider-independent locators (never a real vendor URL in this layer). */
  publishedUrl?: string;
  previewUrl?: string;
  externalId?: string;
  error?: string;
  at: number;
};

export type ProviderHealth = { platform: PlatformId; healthy: boolean; detail?: string; rateLimitPerMin: number };

/**
 * A publishing provider (platform adapter). Interchangeable — the router only knows
 * this interface. Adapters translate a PublishTarget into a platform call and back.
 */
export interface PublishingProvider {
  readonly platform: PlatformId;
  readonly version: string;
  publish(target: PublishTarget): Promise<PublishResult>;
  schedule(target: PublishTarget): Promise<PublishResult>;
  delete(externalId: string): Promise<{ ok: boolean; error?: string }>;
  update(externalId: string, target: PublishTarget): Promise<PublishResult>;
  status(externalId: string): Promise<PublishResult>;
  preview(target: PublishTarget): Promise<{ previewUrl: string }>;
  health(): Promise<ProviderHealth>;
}

// ---- Publishing history (Part 8) ----

export type PublishRecord = {
  id: string;
  assetKey: string;
  platform: PlatformId;
  provider: string;
  version: number;
  at: number;
  retries: number;
  failures: number;
  rolledBack: boolean;
  publishedUrl: string | null;
  previewUrl: string | null;
  status: PublishStatus;
  /** Placeholder for the Learning Engine (next milestone) to fill in. */
  metrics: Record<string, number> | null;
};

// ---- Approvals (Part 6) ----

export const APPROVAL_ROLES = ["creative_director", "marketing_lead", "founder"] as const;
export type ApprovalRole = (typeof APPROVAL_ROLES)[number];

export type ApprovalDecision = "approved" | "rejected" | "changes_requested";

export type ApprovalRecord = {
  id: string;
  assetKey: string;
  role: ApprovalRole;
  user: string;
  decision: ApprovalDecision;
  comments: string;
  version: number;
  at: number;
};

// ---- Content Packages (Part 9) ----

export type PackageAsset = {
  assetKey: string;
  kind: AssetKind;
  label: string;
  channel: string;
  platform: PlatformId;
  campaignId: string;
  dependsOn: string[];
  stage: PublishStage;
};

export type ContentPackage = {
  id: string;
  launchId: string;
  mission: string;
  title: string;
  assets: PackageAsset[];
  /** Asset Graph lineage: edges between package assets (from → to). */
  lineage: { from: string; to: string }[];
  createdAt: number;
};

// ---- Calendar (Part 4) ----

export type CalendarView = "day" | "week" | "month" | "campaign" | "mission" | "platform";

export type CalendarEvent = {
  assetKey: string;
  label: string;
  kind: AssetKind;
  platform: PlatformId;
  channel: string;
  campaignId: string;
  dayOffset: number;
  week: number;
  stage: PublishStage;
};

export type CalendarBucket = { key: string; label: string; events: CalendarEvent[] };

// ---- Events (event-driven, Part 1) ----

export const PUBLISH_EVENTS = [
  "asset.drafted", "asset.generated", "asset.evaluated", "asset.approved", "asset.rejected",
  "asset.scheduled", "asset.publishing", "asset.published", "asset.failed", "asset.retried",
  "asset.rolledback", "asset.measured", "asset.archived", "asset.needs_review",
] as const;
export type PublishEventType = (typeof PUBLISH_EVENTS)[number];

export type PublishEvent = {
  type: PublishEventType;
  assetKey: string;
  stage?: PublishStage;
  platform?: PlatformId;
  at: number;
  data?: Record<string, unknown>;
};
