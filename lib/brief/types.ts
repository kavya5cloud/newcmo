// The Daily Brief.
//
// A projection, not a system. Every number here is read from the engine that already owns
// it — Publishing, Execution, Market Intelligence, Learning, the AI team, Automation. The
// brief adds no state of its own, which is what makes it impossible for it to disagree
// with the screen you click through to.

export type BriefLink = { label: string; href: string };

export type PublishingSection = {
  today: number;
  awaitingApproval: number;
  failed: number;
  /** Failures worth retrying now, as opposed to ones needing a human first. */
  retryable: number;
  nextAt: number | null;
  nextPlatform: string | null;
  links: BriefLink[];
};

export type CampaignLine = {
  id: string;
  title: string;
  health: string;
  percent: number;
  blocked: boolean;
  reason: string | null;
};

export type CampaignsSection = {
  running: number;
  completed: number;
  blocked: number;
  lines: CampaignLine[];
  links: BriefLink[];
};

export type MarketSection = {
  /** Only changes worth reading. An unchanged market produces an empty section. */
  trends: string[];
  competitors: string[];
  opportunities: string[];
  keywords: string[];
  links: BriefLink[];
};

export type PerformanceSection = {
  bestPlatform: string | null;
  winningFormat: string | null;
  bestTime: string | null;
  /** Human sentences. Raw metrics stay behind the expander. */
  improvements: string[];
  /** The underlying numbers, shown only when expanded. */
  detail: { label: string; value: string }[];
};

export type ApprovalsSection = {
  count: number;
  items: { id: string; label: string; href: string }[];
};

export const ACTION_KINDS = [
  "approve", "connect_platform", "retry_publishing", "create_campaign",
  "generate_content", "respond_to_trend", "resume_agent", "review_performance", "none",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export type Recommendation = {
  kind: ActionKind;
  /** What to do, as an instruction. */
  title: string;
  /** Why — always the evidence, never a slogan. */
  why: string;
  /** The one-click action. `href` navigates; `command` runs through the command bar. */
  href: string | null;
  command: string | null;
  /** Higher wins. Used to pick the single recommendation shown. */
  priority: number;
};

export type ActivityLine = { at: number; kind: string; message: string };

export type UpcomingItem = { at: number; label: string; kind: "publish" | "campaign" | "approval" | "automation" };

export type UpcomingSection = {
  today: UpcomingItem[];
  tomorrow: UpcomingItem[];
  thisWeek: UpcomingItem[];
};

export type DailyBrief = {
  tenant: string;
  company: string;
  greeting: string;
  /** The natural-language paragraph. Model-written when possible, else assembled. */
  summary: string;
  summarySource: "llm" | "deterministic";
  publishing: PublishingSection;
  campaigns: CampaignsSection;
  market: MarketSection;
  performance: PerformanceSection;
  approvals: ApprovalsSection;
  recommendation: Recommendation;
  activity: ActivityLine[];
  upcoming: UpcomingSection;
  /** True when the workspace has almost nothing in it — the brief teaches instead. */
  quiet: boolean;
  generatedAt: number;
  /** Fingerprint of the inputs. The brief is stale exactly when this changes. */
  signature: string;
};
