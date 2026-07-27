import type { SocialPlatform } from "@/lib/social/types";

// Automated publishing contracts.
//
// The promise is that a founder describes a cadence in a sentence and Populr keeps it.
// Everything here is about turning that description into concrete, auditable publish
// slots — the slots themselves are handed to the M12 Publishing Engine, which already
// owns scheduling, retries, backoff and the dead-letter queue. Nothing in this layer
// publishes anything itself.

export const CADENCE_KINDS = ["daily", "weekly", "monthly", "custom"] as const;
export type CadenceKind = (typeof CADENCE_KINDS)[number];

/** Days of week, 0 = Sunday, matching Date.getUTCDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  0: "Sunday", 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday",
};

export type Cadence = {
  kind: CadenceKind;
  /** How many posts per period. "3 LinkedIn posts every week" → 3. */
  count: number;
  /** Specific days, when the user named them ("every Friday"). Empty = spread evenly. */
  days: Weekday[];
  /** Day of month for monthly cadences, 1–28 (28 so every month has one). */
  dayOfMonth?: number;
  /** An RRULE string, for cadences the simple kinds can't express. */
  rrule?: string;
};

export const CONTENT_SOURCES = [
  "drafts", "content_library", "campaigns", "ugc_library", "templates", "ai_queue",
] as const;
export type ContentSource = (typeof CONTENT_SOURCES)[number];

export const SOURCE_META: Record<ContentSource, { label: string; blurb: string }> = {
  drafts: { label: "Drafts", blurb: "Posts you've written and saved but not scheduled." },
  content_library: { label: "Content library", blurb: "Everything generated in the studio." },
  campaigns: { label: "Campaigns", blurb: "Assets planned by a launch campaign." },
  ugc_library: { label: "UGC library", blurb: "Approved creator scripts and captions." },
  templates: { label: "Templates", blurb: "Reusable structures you fill each time." },
  ai_queue: { label: "AI queue", blurb: "Populr writes a fresh post when the slot comes up." },
};

/** When a slot is allowed to go out. */
export const RELEASE_MODES = ["immediate", "after_approval", "best_time"] as const;
export type ReleaseMode = (typeof RELEASE_MODES)[number];

export type Automation = {
  id: string;
  tenant: string;
  /** The sentence the user actually typed, kept verbatim so the rule stays auditable. */
  statement: string;
  platform: SocialPlatform;
  cadence: Cadence;
  source: ContentSource;
  release: ReleaseMode;
  /** Paused automations produce no new slots but keep their history. */
  active: boolean;
  createdAt: number;
  updatedAt: number;
};

export const QUEUE_STATES = [
  "upcoming", "waiting_approval", "publishing", "published", "failed", "retrying", "cancelled", "skipped",
] as const;
export type QueueState = (typeof QUEUE_STATES)[number];

/** One concrete occurrence: a platform, a time, and where its content comes from. */
export type QueueItem = {
  id: string;
  tenant: string;
  automationId: string;
  platform: SocialPlatform;
  source: ContentSource;
  /** Epoch ms this slot is due. */
  at: number;
  state: QueueState;
  /** The publishing job id, once the slot has been handed to the Publishing Engine. */
  jobId: string | null;
  /** Manual ordering within the same due time; lower runs first. */
  order: number;
  note: string | null;
};

export type AutomationSummary = {
  automationId: string;
  statement: string;
  platform: SocialPlatform;
  active: boolean;
  /** Human sentence describing the cadence, regenerated from the parsed rule. */
  cadenceLabel: string;
  upcoming: number;
  published: number;
  failed: number;
  nextAt: number | null;
};
