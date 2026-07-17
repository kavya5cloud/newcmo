// Service contracts — the only way Populr's services talk to each other.
// Modules implement these; they never import each other's internals.
// When a service is extracted later, the interface stays and only the transport changes.
// (Full architecture: docs/campaign-studio-architecture.md)

export type RankedChannel = {
  channel: string;
  label: string;
  score: number;
  evidence: {
    yours: { generated: number; approved: number; avgScore: number | null } | null;
    network: { generated: number; approved: number } | null;
  };
};

/** The Creative Brief — every campaign produces one; every asset is generated from it. */
export type CreativeBrief = {
  objective: string;
  audience: string;
  keyMessage: string;
  emotionalAngle: string;
  proof: string;
  cta: string;
  visualDirection: string;
  successMetric: string;
};

export type CampaignTask = {
  week: number;
  channel: string;
  title: string;
  intent: string;
  /** recommendation UUID in the intelligence dataset (mission_task) */
  recId?: string;
  done?: boolean;
};

export type CampaignInput = {
  goal: string;
  title: string;
  brief: CreativeBrief;
  channels: string[];
  timelineDays: number;
  priority: number;          // 1 (highest) … 5
  expectedImpact: string;    // narrative — never invented numbers
  reasoning: string;         // the WHY, decision-first receipt
  tasks: CampaignTask[];
};

export const CAMPAIGN_GOALS = [
  { id: "launch_product", label: "Launch a product" },
  { id: "grow_seo", label: "Increase organic traffic" },
  { id: "go_viral", label: "Go viral" },
  { id: "leads", label: "Generate leads" },
  { id: "hiring", label: "Hire great people" },
  { id: "fundraising", label: "Raise funding" },
] as const;

export const CAMPAIGN_EVENTS = ["created", "activated", "paused", "completed", "task_done", "archived"] as const;
export type CampaignEvent = (typeof CAMPAIGN_EVENTS)[number];
