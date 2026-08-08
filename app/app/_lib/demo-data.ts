// What the dashboard shows before a real analysis exists.
//
// Kept in one file on purpose: anything shown to someone who has not connected their data
// yet is a placeholder, and placeholders that leak into the live view are how a product
// starts lying about what it knows.

import type { Ranking } from "@/lib/store";

export const FALLBACK_RANKS: Ranking[] = [
  { pos: "#3", query: "ai cmo tool", trend: "↑2" },
  { pos: "#7", query: "ai marketing agents", trend: "↑5" },
  { pos: "#11", query: "marketing automation for startups", trend: "↑1" },
  { pos: "#14", query: "seo agency alternative", trend: "new" },
];

export const DOC_DEMO: Record<string, string> = {
  product: "# Product Information\n\nGenerated once Populr analyzes your site with a live AI key.\nUntil then this is a placeholder describing your product, its core loop, and pricing.",
  compet: "# Competitor Analysis\n\nYour top competitors and how Populr positions against them appear here after analysis.",
  voice: "# Brand Voice\n\nAdjectives, do's and don'ts, and a reference line — learned from your site.",
  strategy: "# Marketing Strategy\n\nObjective, channel pillars, and weekly cadence — drafted from your positioning.",
  llms: "# llms.txt\n\nGenerated for AI crawlers so ChatGPT / Perplexity cite you correctly.",
  articles: "# Articles (39)\n\nPublished, drafted, and queued articles live here. Open one from the Articles agent.",
};
