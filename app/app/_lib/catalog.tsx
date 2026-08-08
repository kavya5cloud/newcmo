// The fixed cast: which agents exist, and which documents they can write.
//
// Data, not behaviour. Everything here is static — the per-slot suggestions that actually
// rotate live in lib/agent-feed.ts.

import Icon, { type IconName } from "@/app/components/Icon";

/* ---------- static agent + doc definitions ---------- */
export type AgentDef = { id: string; name: string; color: string; sum: string; items: [string, string][]; icon: React.ReactNode };
export const AGENTS: AgentDef[] = [
  { id: "reddit", name: "Reddit Agent", color: "#FF4500", sum: "High-intent threads to reply to", items: [["Thread: \"tools for early-stage marketing?\" — high intent", "Draft reply"], ["Thread: \"is SEO dead in 2026?\" — share a practical perspective", "Draft reply"], ["Thread: \"AI CMO tools worth it?\" — direct match", "Draft reply"]], icon: <><ellipse cx="12" cy="14" rx="8" ry="5.6" /><circle cx="19.5" cy="9.5" r="1.6" /><path d="M12 8.4l1.2-4.2 4 1.1" strokeLinecap="round" /><circle cx="9" cy="13.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="13.5" r="1.1" fill="currentColor" stroke="none" /><path d="M9.3 16.3c1.7 1.1 3.7 1.1 5.4 0" strokeLinecap="round" /></> },
  { id: "geo", name: "GEO Agent", color: "#5A8DE8", sum: "AI-search citation checks", items: [["Not cited for \"ai marketing automation\" in ChatGPT", "Fix gap"], ["Perplexity cites 2 competitors for your core query", "Fix gap"]], icon: <><circle cx="12" cy="12" r="8.4" /><ellipse cx="12" cy="12" rx="3.6" ry="8.4" /><path d="M3.8 12h16.4" /></> },
  { id: "seo", name: "SEO Agent", color: "#CDA6F2", sum: "Search fixes & keyword plays", items: [["12 pages missing meta descriptions", "Review"], ["Keyword gap: \"marketing copilot\" — 2.1k/mo, low difficulty", "Draft post"]], icon: <><circle cx="11" cy="11" r="6.2" /><path d="M15.6 15.6L20 20" /><path d="M8.5 11h5M11 8.5v5" /></> },
  { id: "x", name: "X Agent", color: "#FAFAFA", sum: "Post & thread ideas", items: [["Thread idea: \"we skipped 80% of our marketing tasks\"", "Draft"], ["Post: launch-week metrics recap", "Draft"]], icon: <path d="M17.2 3h3l-6.6 7.6L21.5 21h-6.1l-4.8-6.2L5.1 21h-3l7.1-8.1L2.5 3h6.2l4.3 5.7L17.2 3zm-1 16.2h1.7L6.9 4.7H5.1l11.1 14.5z" fill="currentColor" stroke="none" /> },
  { id: "articles", name: "Articles Agent", color: "#9A6AE8", sum: "Long-form topics & outlines", items: [["\"AI CMO vs marketing agency: real math\" — outline ready", "Open"], ["\"how to get cited by ChatGPT\" — research done", "Open"]], icon: <><path d="M4 20l1.2-4.2L16.4 4.6a2.05 2.05 0 0 1 2.9 2.9L8.2 18.8 4 20z" /><path d="M14.5 6.5l3 3" /></> },
  { id: "hn", name: "Hacker News Agent", color: "#FF6600", sum: "Launch post prep", items: [["Show HN: a focused marketing operating system", "Review"]], icon: <><rect x="3" y="3" width="18" height="18" rx="3.5" /><path d="M8.3 7.5l3.7 5.2v4M15.7 7.5L12 12.7" strokeWidth="1.9" strokeLinecap="round" /></> },
  { id: "linkedin", name: "LinkedIn Agent", color: "#0A66C2", sum: "Founder post drafts", items: [["Founder post: why we skip most marketing tasks", "Review"]], icon: <><rect x="3" y="3" width="18" height="18" rx="3.5" /><circle cx="8" cy="8.3" r="1.25" fill="currentColor" stroke="none" /><path d="M8 11.2v6" strokeWidth="2" strokeLinecap="round" /><path d="M12.2 17.2v-6" strokeWidth="2" strokeLinecap="round" /><path d="M12.2 13.6a2.5 2.5 0 0 1 5 0v3.6" strokeWidth="2" strokeLinecap="round" /></> },
  { id: "ugc", name: "UGC Videos Agent", color: "#E8843A", sum: "Short product clips", items: [["Storyboard a 15s product clip", "Plan"]], icon: <><rect x="2.8" y="4.8" width="18.4" height="14.4" rx="3" /><path d="M10.2 9.2l4.6 2.8-4.6 2.8V9.2z" fill="currentColor" stroke="none" /></> },
  { id: "infl", name: "Influencer Campaigns", color: "#3ECF8E", sum: "Launch your first campaign", items: [["Build a scored creator shortlist for your niche", "Open list"]], icon: <path d="M20 4L7 8.5H4.5A2.5 2.5 0 0 0 2 11v2a2.5 2.5 0 0 0 2.5 2.5H6V19a1.5 1.5 0 0 0 1.5 1.5H9a1 1 0 0 0 1-1v-3.6l10 3.6V4z" /> },
];

export const DOCS: { id: string; name: string; icon: IconName; tag?: string; count?: string }[] = [
  { id: "product", name: "Product Information", icon: "doc" },
  { id: "compet", name: "Competitor Analysis", icon: "search" },
  { id: "voice", name: "Brand Voice", icon: "pen" },
  { id: "strategy", name: "Marketing Strategy", icon: "target" },
  { id: "llms", name: "llms.txt", icon: "queue", tag: "new" },
  { id: "articles", name: "Articles", icon: "library", count: "(39)" },
];

// The boot log is derived from the real workspace — brand, host, the channels that
// actually have work, and the real agent count — not hardcoded numbers.
export function buildTermLines(brand: string, host: string, channels: string[], agentCount: number): [string, string][] {
  const lines: [string, string][] = [["tl-p", `$ populr run --daily ${host}`]];
  const shown = channels.slice(0, 6);
  for (const ch of shown) lines.push(["", `> [${ch}] scanning for ${brand} opportunities…`]);
  lines.push(["", "> fetching analytics…"]);
  lines.push(["", "> reviewing documents and preparing your CMO…"]);
  lines.push(["tl-ok", `AI CMO ready — ${agentCount} agent${agentCount === 1 ? "" : "s"} on ${host}`]);
  return lines;
}
