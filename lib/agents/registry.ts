import type { WorkflowStep } from "@/lib/execution/types";
import { AGENT_IDS, type AgentId, type AgentProfile } from "./types";

// The team roster. One place that says who does what, which services they work through,
// and which workflow steps they own — so the Execution Engine can map a step to an agent
// without either side knowing about the other's internals.

export const AGENT_PROFILES: Record<AgentId, AgentProfile> = {
  research: {
    id: "research", name: "Research", role: "Understands the market before anyone writes anything",
    responsibilities: ["Industry research", "Competitor analysis", "Trend discovery", "Audience research", "Opportunity discovery"],
    uses: ["Market Intelligence", "Business Graph", "Market Memory"],
    steps: ["research", "market_intelligence"],
  },
  strategy: {
    id: "strategy", name: "Strategy", role: "Turns findings into a plan with cadence and metrics",
    responsibilities: ["Campaign planning", "Content pillars", "Publishing cadence", "Platform strategy", "Marketing goals", "Success metrics"],
    uses: ["Launch Engine", "Business Graph", "Market Memory"],
    steps: ["campaign_planning"],
  },
  content: {
    id: "content", name: "Content", role: "Writes everything the campaign needs, per platform",
    responsibilities: ["Blogs", "LinkedIn", "Threads", "X", "Instagram", "Facebook", "Pinterest", "Emails", "Landing page copy", "Scripts", "SEO content", "Platform-specific variants"],
    uses: ["Content Studio", "Job Engine", "Learning Engine"],
    steps: ["copy_generation"],
  },
  creative: {
    id: "creative", name: "Creative", role: "Produces the visuals and keeps them on brand",
    responsibilities: ["Image generation", "Carousel generation", "Ad creatives", "Thumbnails", "Visual suggestions", "Brand consistency"],
    uses: ["Content Studio", "Job Engine", "Creative Director"],
    steps: ["asset_generation"],
  },
  editor: {
    id: "editor", name: "Editor", role: "Cuts the AI slop before anything reaches you",
    responsibilities: ["Grade every draft", "Reject stock AI phrasing", "Catch unsourced claims", "Send weak openings back", "Break up monotone prose"],
    // The same grader the composer runs, on purpose. An editor working from different rules
    // than the writer rejects work the writer was instructed to produce.
    uses: ["Craft scorer", "Content Studio"],
    steps: ["editing"],
  },
  seo: {
    id: "seo", name: "SEO", role: "Reads the site the way a search engine does",
    responsibilities: ["On-page audit", "Title and description checks", "Heading structure", "Core Web Vitals", "PageSpeed scores"],
    uses: ["SEO audit", "PageSpeed Insights"],
    steps: ["site_audit"],
  },
  publishing: {
    id: "publishing", name: "Publishing", role: "Gets approved work out safely, on every platform",
    responsibilities: ["Prepare publishing", "Validate content", "Optimise for platforms", "Schedule", "Retry", "Approval routing"],
    uses: ["Cross-Platform Publishing Engine", "Platform adapters"],
    steps: ["platform_optimization", "publishing"],
  },
  analytics: {
    id: "analytics", name: "Analytics", role: "Reports what actually happened, not what was hoped",
    responsibilities: ["Campaign summaries", "Performance reports", "Growth analysis", "Audience insights", "Content recommendations", "ROI summaries"],
    uses: ["Publishing history", "Learning Engine"],
    steps: ["analytics"],
  },
  learning: {
    id: "learning", name: "Learning", role: "Makes the next campaign better than this one",
    responsibilities: ["Update Market Memory", "Learn campaign outcomes", "Detect successful patterns", "Improve future recommendations"],
    uses: ["Learning Engine", "Market Memory", "Business Graph"],
    steps: ["learning", "optimization"],
  },
};

/** Which agent owns a workflow step. `mission` and `approval` are engine gates, not work. */
export function agentForStep(step: WorkflowStep): AgentId | null {
  for (const id of AGENT_IDS) {
    if (AGENT_PROFILES[id].steps.includes(step)) return id;
  }
  return null;
}

/**
 * Who an agent's work builds on. This is a *reporting* relationship for the execution
 * graph, not a call graph — no agent ever invokes another. The Execution Engine runs them
 * in workflow order and their shared context carries the previous agent's effect.
 */
export const AGENT_DEPENDENCIES: Record<AgentId, AgentId[]> = {
  research: [],
  strategy: ["research"],
  content: ["strategy", "research"],
  creative: ["strategy", "content"],
  // Nothing reaches Publishing without passing the Editor. That is the point of having one:
  // an editor downstream of publishing is a critic, not a gate.
  editor: ["content"],
  seo: ["research"],
  publishing: ["content", "creative", "editor"],
  analytics: ["publishing"],
  learning: ["analytics"],
};

export const TEAM_ORDER: AgentId[] = [
  "research", "strategy", "seo", "content", "creative", "editor", "publishing", "analytics", "learning",
];
