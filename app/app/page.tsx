"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadState, saveState, workspaceId, type Saved, type Profile, type Draft, type ChatMsg, type FeedEntry, type Ranking } from "@/lib/store";
import { CHANNEL_LABELS, formatWindowLabel, channelSchedule, type PublishChannel } from "@/lib/publish-times";
import { matchGscSite, displaySite } from "@/lib/gsc-match";
import { fetchPushStatus, subscribePush, unsubscribePush, type PushStatus } from "@/lib/push-client";

/* ---------- AI call (proxied through /api/generate) ---------- */
async function ai(prompt: string, url?: string): Promise<string> {
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, url: url || null }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const detail = [d.error, d.kind, d.provider, d.model, d.status, d.detail]
      .filter(Boolean)
      .join(" · ");
    throw new Error(detail || "api " + r.status);
  }
  return d.text as string;
}
function parseJSON(txt: string) {
  const clean = txt.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  return JSON.parse(clean.slice(s, e + 1));
}
function hostOf(u: string) {
  try { return new URL(u).hostname.replace("www.", ""); } catch { return u; }
}

/* ---------- growth sources: not everyone has a website ---------- */
type SourceType = "website" | "instagram" | "linkedin" | "x" | "youtube" | "gbp";

const SOURCES: { id: SourceType; label: string; placeholder: string }[] = [
  { id: "website", label: "website", placeholder: "https://yourcompany.com" },
  { id: "instagram", label: "instagram", placeholder: "@yourhandle" },
  { id: "linkedin", label: "linkedin", placeholder: "company name or linkedin.com/company/…" },
  { id: "x", label: "x", placeholder: "@yourhandle" },
  { id: "youtube", label: "youtube", placeholder: "@yourchannel" },
  { id: "gbp", label: "google business", placeholder: "business name, city" },
];

const SOURCE_LABEL: Record<SourceType, string> = {
  website: "website", instagram: "Instagram profile", linkedin: "LinkedIn page",
  x: "X profile", youtube: "YouTube channel", gbp: "Google Business Profile",
};

/** Turn whatever the user typed (handle, name, or URL) into a canonical public URL. */
function canonicalSource(source: SourceType, raw: string): { url: string; display: string } {
  const t = raw.trim();
  if (source === "website" || /^https?:\/\//.test(t)) {
    let u = t;
    if (!/^https?:\/\//.test(u)) u = "https://" + u;
    return { url: u, display: t.replace(/^https?:\/\//, "") };
  }
  const handle = t.replace(/^@/, "").replace(/\/+$/, "");
  switch (source) {
    case "instagram": return { url: `https://www.instagram.com/${handle}/`, display: "@" + handle };
    case "x": return { url: `https://x.com/${handle}`, display: "@" + handle };
    case "youtube": return { url: `https://www.youtube.com/@${handle}`, display: "@" + handle };
    case "linkedin": return { url: `https://www.linkedin.com/company/${handle.toLowerCase().replace(/\s+/g, "-")}/`, display: t };
    default: return { url: `https://www.google.com/maps/search/${encodeURIComponent(t)}`, display: t };
  }
}

/* ---------- intelligence dataset logging (fire-and-forget, never blocks UI) ---------- */
function logRecBatch(
  url: string,
  profile: Profile,
  feed: Record<string, FeedEntry>
): Promise<Record<string, string>> {
  const items = Object.entries(feed).flatMap(([channel, entry]) =>
    (entry.items || []).map(([title, action], i) => ({ channel, title, action, clientKey: `${channel}:${i}` }))
  );
  if (!items.length) return Promise.resolve({});
  return fetch("/api/intel/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wsid: workspaceId(), url, profile, items }),
  })
    .then((r) => r.json())
    .then((d) => (d?.ids && typeof d.ids === "object" ? (d.ids as Record<string, string>) : {}))
    .catch(() => ({}));
}

function logRecEvent(
  recId: string | undefined,
  event: string,
  asset?: { title: string; body: string; channel: string },
  metadata?: Record<string, unknown>
) {
  if (!recId) return;
  fetch("/api/intel/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wsid: workspaceId(), recommendationId: recId, event, asset, metadata }),
  }).catch(() => {});
}

const DAY_MS = 86_400_000;

function trialSnapshot(trial: { active: boolean; daysLeft: number; endsAt: string } | null, nowMs: number) {
  if (!trial) return null;
  const endMs = Date.parse(trial.endsAt);
  if (!Number.isFinite(endMs)) return trial;
  const liveDaysLeft = Math.max(0, Math.ceil((endMs - nowMs) / DAY_MS));
  return {
    ...trial,
    daysLeft: liveDaysLeft,
    active: nowMs < endMs,
  };
}

/**
 * No fake numbers, ever: if a channel summary contains a digit (AI models love inventing
 * "36 opportunities ready"), replace it with the real item count. Summaries without
 * numbers are kept — qualitative notes are fine, invented statistics are not.
 */
function withHonestSummaries(feed: Record<string, FeedEntry>): Record<string, FeedEntry> {
  const out: Record<string, FeedEntry> = {};
  for (const [ch, entry] of Object.entries(feed)) {
    const n = entry.items?.length || 0;
    const honest = entry.summary && !/\d/.test(entry.summary)
      ? entry.summary
      : `${n} ${n === 1 ? "opportunity" : "opportunities"} ready to review`;
    out[ch] = { ...entry, summary: honest };
  }
  return out;
}

function feedText(entry?: FeedEntry) {
  return (entry?.items || []).map(([t]) => t).join(" ").toLowerCase();
}

function feedLooksGeneric(entry?: FeedEntry) {
  const text = feedText(entry);
  return !text || /cosmos(?:\.ai)?|populr|short (?:thread angle|keyword or fix|ai-search gap|post idea|article title)|draft reply|fix gap|review|open/.test(text) || text.length < 30;
}

function buildFallbackFeed(profile: Profile | null, url: string): Record<string, FeedEntry> {
  const host = hostOf(url);
  const brand = profile?.name || host;
  const oneLiner = profile?.oneLiner || "your product";
  const audience = profile?.audience || "buyers";
  const position = profile?.positioning || `Position ${brand} around the main pain it solves.`;
  return {
    reddit: {
      summary: `3 discussion angles for ${host}`,
      items: [
        [`Lead with the pain ${audience} feel before they buy`, "Draft reply"],
        [`Reply with a concrete example from ${brand}`, "Draft reply"],
      ],
    },
    seo: {
      summary: `3 search opportunities for ${host}`,
      items: [
        [`Comparison page: ${brand} vs alternatives`, "Draft post"],
        [`FAQ page based on "${oneLiner}"`, "Draft post"],
      ],
    },
    geo: {
      summary: `AI citation opportunities for ${host}`,
      items: [
        [`Add a crisp definition of ${brand} for AI answers`, "Fix gap"],
        [`Use FAQ schema so ${position.slice(0, 48).replace(/\s+/g, " ")}…`, "Fix gap"],
      ],
    },
    x: {
      summary: `Social angles for ${host}`,
      items: [
        [`Thread: the one thing ${brand} does that others don't`, "Draft"],
        [`Post: a before/after story for ${audience}`, "Draft"],
      ],
    },
    linkedin: {
      summary: `Founder posts for ${host}`,
      items: [
        [`Founder post: why ${brand} exists and what it refuses to do`, "Review"],
        [`Post: one lesson from building ${oneLiner}`, "Review"],
      ],
    },
    articles: {
      summary: `Long-form topics for ${host}`,
      items: [
        [`"${brand} vs the old way: what changes"`, "Open"],
        [`"How ${audience} should evaluate tools like ${brand}"`, "Open"],
      ],
    },
    hn: {
      summary: `Launch angles for ${host}`,
      items: [
        [`Show HN draft: ${brand} — ${oneLiner}`, "Review"],
        [`Comment angle: explain the problem ${brand} removes`, "Review"],
      ],
    },
  };
}

function normalizeFeed(feed: Record<string, FeedEntry> | undefined, profile: Profile | null, url: string) {
  const fallback = buildFallbackFeed(profile, url);
  const out: Record<string, FeedEntry> = { ...fallback, ...(feed || {}) };
  for (const id of ["hn", "linkedin"] as const) {
    if (feedLooksGeneric(out[id])) out[id] = fallback[id];
  }
  return out;
}

function summarizeItems(items: [string, string][] | undefined, limit = 2) {
  return (items || []).slice(0, limit).map(([t]) => t).join(" | ");
}

function buildChatPrompt(input: {
  profile: Profile | null;
  url: string;
  competitors: { n: string; c: string }[];
  feed: Record<string, FeedEntry>;
  rankings: Ranking[];
  drafts: Draft[];
  estTraffic: { impressions: number; clicks: number; visits: number } | null;
  gscData: null | {
    site: string; impressions: string; clicks: string; ctr: string; position: string;
    deltas: { impressions: string; clicks: string; ctr: string; position: string };
    series: { labels: string[]; impressions: number[]; clicks: number[] };
    queries: { pos: string; query: string; trend: string; clicks?: number; ctr?: string }[];
    pages: { page: string; impressions: number; clicks: number; ctr: string; position: string }[];
    hourClicks: { hour: number; clicks: number }[];
  };
  recentTurns: ChatMsg[];
  question: string;
  mode: "strategy" | "copy";
}) {
  const brand = input.profile?.name || hostOf(input.url) || "the site";
  const oneLiner = input.profile?.oneLiner || "the product";
  const audience = input.profile?.audience || "buyers";
  const positioning = input.profile?.positioning || "positioning not yet available";
  const voice = input.profile?.voice || "clear, practical, concise";
  const competitors = input.competitors.map((c) => c.n).filter(Boolean).join(", ") || "none";
  const draftSummary = input.drafts
    .filter((d) => !d.published)
    .slice(0, 3)
    .map((d) => `${CHANNEL_LABELS[d.channel as PublishChannel] || d.channel}: ${d.title}`)
    .join(" | ") || "none";
  const rankingSummary = input.rankings.slice(0, 4).map((r) => `${r.pos} ${r.query} (${r.trend})`).join(" | ") || "none";
  const topFeed = Object.entries(input.feed)
    .map(([k, v]) => `${k}: ${summarizeItems(v.items)}`)
    .join("\n") || "none";
  const gsc = input.gscData
    ? `Live Search Console: ${input.gscData.clicks} clicks, ${input.gscData.impressions} impressions, CTR ${input.gscData.ctr}, position ${input.gscData.position}.`
    : "Live Search Console: unavailable.";
  const traffic = input.estTraffic
    ? `Estimated search traffic: ${input.estTraffic.clicks} clicks from ${input.estTraffic.impressions} impressions, ${input.estTraffic.visits} visits.`
    : "Estimated search traffic: unavailable.";
  const history = input.recentTurns.slice(-6).map((m) => `${m.who === "me" ? "Founder" : "AI CMO"}: ${m.text}`).join("\n") || "none";
  const modeBlock = input.mode === "copy"
    ? "This is a copywriting request. Prioritize concrete draft language, hooks, headlines, and edits that can be pasted directly."
    : "This is a strategy request. Prioritize direction, tradeoffs, sequencing, and the highest-leverage action.";

  return `You are the AI CMO for ${brand}.
Be specific, concise, and pragmatic.
Never be generic. Use the company's actual context. If the question is underspecified, ask one sharp follow-up and give one immediate recommendation.
Prefer bullets when it improves clarity. Keep the answer to 2-5 short paragraphs or bullet groups.
${modeBlock}

Company:
- URL: ${input.url || "unknown"}
- Brand: ${brand}
- One-liner: ${oneLiner}
- Audience: ${audience}
- Positioning: ${positioning}
- Voice: ${voice}
- Competitors: ${competitors}

Current state:
- ${gsc}
- ${traffic}
- Open drafts: ${draftSummary}
- Top rankings: ${rankingSummary}
- Feed: ${topFeed}

Recent conversation:
${history}

Founder question:
${input.question}`;
}

/* ---------- static agent + doc definitions ---------- */
type AgentDef = { id: string; name: string; color: string; sum: string; items: [string, string][]; icon: React.ReactNode };
const AGENTS: AgentDef[] = [
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

const DOCS = [
  { id: "product", name: "Product Information", icon: "▤" },
  { id: "compet", name: "Competitor Analysis", icon: "▥" },
  { id: "voice", name: "Brand Voice", icon: "✎" },
  { id: "strategy", name: "Marketing Strategy", icon: "◎" },
  { id: "llms", name: "llms.txt", icon: "⌥", tag: "new" },
  { id: "articles", name: "Articles", icon: "▸", count: "(39)" },
];

const TERM_LINES: [string, string][] = [
  ["tl-p", "$ populr run --daily"],
  ["", "> [seo] crawling sitemap… 214 pages"],
  ["", "> [seo] scoring keyword gaps against 3 competitors…"],
  ["", "> [reddit] scanning 14 subreddits for buying intent…"],
  ["", "> [geo] querying ChatGPT / Perplexity for brand citations…"],
  ["", "> [articles] researching 4 topic clusters…"],
  ["", "> [ugc video] applying motion synthesis…"],
  ["", "> fetching analytics…"],
  ["", "> loading documents and initializing AI chat…"],
  ["tl-ok", "✓ AI CMO initialized — 9 agents reporting"],
];

const CHART = {
  "7d": { labels: ["7/5", "7/6", "7/7", "7/8", "7/9", "7/10", "7/11"], visits: [2100, 3050, 2700, 1900, 2050, 2350, 2600], clicks: [420, 510, 480, 390, 410, 460, 520], saw: "82.4K", sawD: "+12.3%", clicked: "3.9K", clickedD: "+48.2%", visited: "15.1K", visitedD: "+21.4%" },
  "30d": { labels: ["6/12", "6/17", "6/22", "6/27", "7/2", "7/7", "7/11"], visits: [1500, 1800, 2400, 2200, 2900, 2600, 3100], clicks: [280, 330, 450, 410, 520, 480, 560], saw: "301K", sawD: "+9.8%", clicked: "13.2K", clickedD: "+31.5%", visited: "54.7K", visitedD: "+17.9%" },
};

// deterministic PRNG seeded from a string, so a given site always shows the same estimate
function seedRand(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function fmtN(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}
function dayLabels(range: "7d" | "30d"): string[] {
  const out: string[] = [];
  const step = range === "7d" ? 1 : 5;
  for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - (i * step + 2) * 86400000); out.push(`${d.getMonth() + 1}/${d.getDate()}`); }
  return out;
}
// Build a CHART-shaped view from monthly estimates, scaled to the range with plausible variance.
function buildEstData(est: { impressions: number; clicks: number; visits: number }, range: "7d" | "30d", seed: string) {
  const rnd = seedRand(seed + range);
  const scale = (range === "7d" ? 7 : 30) / 30;
  const impT = est.impressions * scale, clkT = est.clicks * scale, visT = est.visits * scale;
  const w = Array.from({ length: 7 }, () => 0.55 + rnd() * 0.9);
  const wsum = w.reduce((a, b) => a + b, 0);
  const visits = w.map((x) => Math.round((visT * x) / wsum));
  const clicks = w.map((x) => Math.round((clkT * x) / wsum));
  const delta = () => "+" + (4 + Math.floor(rnd() * 42)) + "." + Math.floor(rnd() * 10) + "%";
  return {
    labels: dayLabels(range), visits, clicks,
    saw: fmtN(impT), sawD: delta(), clicked: fmtN(clkT), clickedD: delta(), visited: fmtN(visT), visitedD: delta(),
  };
}

const FALLBACK_RANKS: Ranking[] = [
  { pos: "#3", query: "ai cmo tool", trend: "↑2" },
  { pos: "#7", query: "ai marketing agents", trend: "↑5" },
  { pos: "#11", query: "marketing automation for startups", trend: "↑1" },
  { pos: "#14", query: "seo agency alternative", trend: "new" },
];

const DOC_DEMO: Record<string, string> = {
  product: "# Product Information\n\nGenerated once Populr analyzes your site with a live AI key.\nUntil then this is a placeholder describing your product, its core loop, and pricing.",
  compet: "# Competitor Analysis\n\nYour top competitors and how Populr positions against them appear here after analysis.",
  voice: "# Brand Voice\n\nAdjectives, do's and don'ts, and a reference line — learned from your site.",
  strategy: "# Marketing Strategy\n\nObjective, channel pillars, and weekly cadence — drafted from your positioning.",
  llms: "# llms.txt\n\nGenerated for AI crawlers so ChatGPT / Perplexity cite you correctly.",
  articles: "# Articles (39)\n\nPublished, drafted, and queued articles live here. Open one from the Articles agent.",
};

/* ---------- component ---------- */
export default function AppPage() {
  const [entered, setEntered] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [url, setUrl] = useState("");
  const [inputUrl, setInputUrl] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [competitors, setCompetitors] = useState<{ n: string; c: string }[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [feed, setFeed] = useState<Record<string, FeedEntry>>({});
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [estTraffic, setEstTraffic] = useState<{ impressions: number; clicks: number; visits: number } | null>(null);
  const [docCache, setDocCache] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"overview" | "seo">("overview");
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [gscSite, setGscSite] = useState<string>("");
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [doc, setDoc] = useState<{ title: string; body: string } | null>(null);
  const [toast, setToast] = useState("");
  const [termCollapsed, setTermCollapsed] = useState(false);
  const [demo, setDemo] = useState(false);
  const [progress, setProgress] = useState<number>(-1);
  const [busyItem, setBusyItem] = useState<string>("");
  const [recIds, setRecIds] = useState<Record<string, string>>({});
  const [source, setSource] = useState<SourceType>("website");
  const [sourceDesc, setSourceDesc] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [chatMode, setChatMode] = useState<"strategy" | "copy">("strategy");
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [accountsEnabled, setAccountsEnabled] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [trial, setTrial] = useState<{ active: boolean; daysLeft: number; endsAt: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [mtab, setMtab] = useState<"company" | "analytics" | "agents" | "chat">("company");
  const [gsc, setGsc] = useState<{ configured: boolean; connected: boolean; sites: string[] }>({ configured: false, connected: false, sites: [] });
  const [gscError, setGscError] = useState<string | null>(null);
  const [verifyPopup, setVerifyPopup] = useState(false);
  const verifyShownRef = useRef(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [gscData, setGscData] = useState<null | {
    site: string; impressions: string; clicks: string; ctr: string; position: string;
    deltas: { impressions: string; clicks: string; ctr: string; position: string };
    series: { labels: string[]; impressions: number[]; clicks: number[] };
    queries: { pos: string; query: string; trend: string; clicks?: number; ctr?: string }[];
    pages: { page: string; impressions: number; clicks: number; ctr: string; position: string }[];
    hourClicks: { hour: number; clicks: number }[];
  }>(null);

  const tlogRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);
  const hydrated = useRef(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };
  const aiErrorText = (err: unknown) => err instanceof Error ? err.message : String(err);
  const liveTrial = useMemo(() => trialSnapshot(trial, nowTick), [trial, nowTick]);

  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("cosmos.chatMode");
      if (stored === "copy" || stored === "strategy") setChatMode(stored);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("cosmos.chatMode", chatMode);
    } catch {}
  }, [chatMode]);

  /* ---- hydrate from persistence on mount ---- */
  useEffect(() => {
    (async () => {
      const { saved, cloud } = await loadState();
      setCloud(cloud);
      if (saved?.profile) {
        setUrl(saved.url); setProfile(saved.profile);
        setCompetitors(saved.competitors || []); setChat(saved.chat || []);
        setDrafts(saved.drafts || []); setFeed(saved.feed || {});
        setRankings(saved.rankings || []); setDocCache(saved.docs || {});
        setEstTraffic(saved.estTraffic || null);
        setGscSite(saved.gscSite || "");
        setRecIds(saved.recIds || {});
        setEntered(true);
      }
      hydrated.current = true;
    })();
  }, []);

  /* ---- auth status ---- */
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { setAuthUser(d.user?.email || null); setAccountsEnabled(!!d.accountsEnabled); setTrial(d.trial || null); })
      .catch(() => {})
      .finally(() => setAuthReady(true));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    // clear the local workspace so the signed-out user can't keep using the account's data
    try { localStorage.removeItem("cosmos.state"); localStorage.removeItem("cosmos.nudgeDismissed"); } catch {}
    location.reload();
  }

  // Sign-in is required to use the app once accounts are enabled.
  const mustSignIn = authReady && accountsEnabled && !authUser && entered;

  /* collapse the decorative terminal by default on small screens */
  useEffect(() => {
    if (entered && typeof window !== "undefined" && window.innerWidth <= 720) setTermCollapsed(true);
  }, [entered]);

  /* ---- Google Search Console status (+ handle OAuth redirect) ---- */
  useEffect(() => {
    fetch("/api/google/status").then((r) => r.json()).then((g) => {
      setGsc(g);
      setGscError(null);
      if (g.connected && g.sites?.length && url) {
        const matched = matchGscSite(g.sites, url);
        if (matched) setGscSite(matched);
      }
    }).catch(() => {});
    const p = new URLSearchParams(window.location.search).get("gsc");
    if (p) {
      const msg: Record<string, string> = {
        connected: "Search Console connected ✓",
        notconfigured: "Google isn't configured on the server yet",
        denied: "Connection cancelled",
        error: "Couldn't connect — try again",
        login: "Sign in first, then connect",
      };
      if (msg[p]) { setToast(msg[p]); setTimeout(() => setToast(""), 3000); }
      window.history.replaceState({}, "", "/app");
    }
    const qs = new URLSearchParams(window.location.search);
    const t = qs.get("tab");
    if (t === "agents" || t === "analytics" || t === "company" || t === "chat") setMtab(t);
    const ch = qs.get("channel");
    if (ch) setOpen((o) => ({ ...o, [ch]: true }));
  }, [authUser, url]);

  /* ---- one-time "site not verified" popup when connected but no verified property ---- */
  useEffect(() => {
    if (authUser && gsc.connected && gsc.sites.length === 0 && !verifyShownRef.current) {
      verifyShownRef.current = true;
      setVerifyPopup(true);
    }
  }, [authUser, gsc]);

  /* ---- push notification status ---- */
  useEffect(() => {
    if (!authUser) { setPushStatus(null); return; }
    fetchPushStatus().then(setPushStatus).catch(() => {});
  }, [authUser]);

  /* ---- pull real Search Console data when connected ---- */
  useEffect(() => {
    if (!gsc.connected || !gsc.sites.length) { setGscData(null); setGscError(null); return; }
    const site = (gscSite && gsc.sites.includes(gscSite) ? gscSite : null) || matchGscSite(gsc.sites, url) || gsc.sites[0];
    if (site && site !== gscSite) setGscSite(site);
    const q = new URLSearchParams({ site, range, url });
    fetch(`/api/google/data?${q}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setGscData(null);
          setGscError(d.error);
        } else {
          setGscData(d);
          setGscError(null);
        }
      })
      .catch((err) => {
        setGscData(null);
        setGscError(String(err).slice(0, 120));
      });
  }, [gsc, range, gscSite, url]);

  /* ---- persist whenever meaningful state changes ---- */
  useEffect(() => {
    if (!hydrated.current || !entered || !profile || demo) return;
    const s: Saved = { url, profile, competitors, chat, drafts, feed, rankings, docs: docCache, estTraffic, gscSite, recIds };
    saveState(s);
  }, [url, profile, competitors, chat, drafts, feed, rankings, docCache, estTraffic, entered, demo, gscSite, recIds]);

  /* ---- onboarding dot canvas ---- */
  useEffect(() => {
    if (entered) return;
    const dcv = dotsRef.current;
    if (!dcv) return;
    const dg = dcv.getContext("2d")!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let DW = 0, DH = 0, GAP = 0, pts: { x: number; y: number; ph: number }[] = [], raf = 0;
    const dsize = () => {
      if (!dcv.parentElement) return;
      const r = dcv.parentElement.getBoundingClientRect();
      DW = dcv.width = r.width * devicePixelRatio; DH = dcv.height = r.height * devicePixelRatio;
      dcv.style.width = r.width + "px"; dcv.style.height = r.height + "px";
      GAP = 26 * devicePixelRatio; pts = [];
      for (let y = GAP / 2; y < DH; y += GAP) for (let x = GAP / 2; x < DW; x += GAP) pts.push({ x, y, ph: x * 0.011 + y * 0.017 });
    };
    const ddraw = (t: number) => {
      dg.clearRect(0, 0, DW, DH); const tt = t * 0.00028;
      for (const d of pts) {
        const w = Math.sin(d.x * 0.0016 + d.y * 0.0011 + tt * 2 + d.ph) * 0.5 + 0.5;
        const w2 = Math.sin(d.y * 0.002 - tt * 1.4) * 0.5 + 0.5; const b = w * 0.7 + w2 * 0.3;
        const a = 0.03 + b * 0.1, s = (1.1 + b * 1.9) * devicePixelRatio;
        dg.fillStyle = `rgba(250,250,250,${a.toFixed(3)})`; dg.fillRect(d.x - s / 2, d.y - s / 2, s, s);
      }
      if (!reduce) raf = requestAnimationFrame(ddraw);
    };
    dsize(); addEventListener("resize", dsize);
    if (reduce) ddraw(0); else raf = requestAnimationFrame(ddraw);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", dsize); };
  }, [entered]);

  /* ---- terminal strip stream on enter ---- */
  useEffect(() => {
    if (!entered) return;
    const el = tlogRef.current; if (!el) return;
    el.innerHTML = "";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { el.innerHTML = TERM_LINES.map(([c, t]) => `<div class="${c}">${esc(t)}</div>`).join(""); return; }
    let i = 0; let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      if (!tlogRef.current) return;
      if (i >= TERM_LINES.length) { el.insertAdjacentHTML("beforeend", '<div><span class="tl-p">populr@ai:~$</span> <span style="display:inline-block;width:7px;height:12px;background:var(--fg);vertical-align:-2px"></span></div>'); el.scrollTop = el.scrollHeight; return; }
      const [c, t] = TERM_LINES[i++];
      el.insertAdjacentHTML("beforeend", `<div class="${c}">${esc(t)}</div>`); el.scrollTop = el.scrollHeight;
      timer = setTimeout(next, 240 + Math.random() * 260);
    };
    timer = setTimeout(next, 300);
    return () => clearTimeout(timer);
  }, [entered]);

  useEffect(() => { chatBodyRef.current?.scrollTo(0, chatBodyRef.current.scrollHeight); }, [chat, typing]);

  /* ---- analyze ---- */
  const analyze = useCallback(async () => {
    if (!inputUrl.trim()) return;
    const { url: u, display } = canonicalSource(source, inputUrl);
    setUrl(u); setProgress(0); setGscError(null); setGscSite(""); setRecIds({});
    const steps = 5;
    const bump = (n: number) => setProgress(n);
    let lastErr: unknown = null;
    try {
      bump(1);
      // Retry once so a single flaky response / malformed JSON doesn't drop the whole
      // analysis into demo mode (and then get saved).
      let p: Profile | null = null;
      for (let attempt = 0; attempt < 2 && !p; attempt++) {
        try {
          const subject = source === "website" ? `the website ${u}` : `the ${SOURCE_LABEL[source]} ${display} (${u})`;
          const srcNote = source === "website" ? "" : " Social pages expose limited content — infer carefully from what's available, never invent specifics.";
          const descLine = sourceDesc.trim() ? `\nThe owner describes the business as: "${sourceDesc.trim().slice(0, 300)}". Treat this as the primary source of truth.` : "";
          const txt = await ai(
            `Analyze ${subject} using the page content above.${srcNote}${descLine}\nRespond ONLY with JSON, no markdown fences, no preamble:\n{"name":"company name","oneLiner":"what it does in one sentence","audience":"who buys it","positioning":"2-sentence positioning summary","competitors":["3-4 names"],"voice":"3 adjectives for brand voice","description":"a 4-sentence company overview for a dashboard sidebar"}`,
            source === "gbp" ? undefined : u
          );
          p = parseJSON(txt) as Profile;
        } catch (e) { lastErr = e; }
      }
      if (!p) throw lastErr || new Error("profile_failed");
      bump(3);
      setProfile(p);
      const comps = (p.competitors || []).slice(0, 4).map((n, i) => ({ n, c: ["#E86A3A", "#5A8DE8", "#E8843A", "#9A6AE8"][i % 4] }));
      setCompetitors(comps);
      // Phase 2: generate a company-specific agents feed + rankings, and (separately) an
      // estimated-traffic figure. Kept as two calls so a failure in one can't break the other.
      let genFeed: Record<string, FeedEntry> | null = null;
      const insP = ai(
        `You are Populr, an AI CMO for ${p.name} — ${p.oneLiner}. Audience: ${p.audience}. Competitors: ${(p.competitors || []).join(", ")}.
Output ONLY compact valid JSON (no markdown, no prose). Each item's first string is a specific, descriptive opportunity in 6-12 words. Do not mention Populr unless the analyzed site is Populr. Never invent counts or statistics anywhere. Exactly this shape:
{"feed":{"reddit":{"summary":"short channel note, no numbers","items":[["short thread angle","Draft reply"]]},"seo":{"summary":"short channel note, no numbers","items":[["short keyword or fix","Draft post"]]},"geo":{"summary":"short channel note, no numbers","items":[["short AI-search gap","Fix gap"]]},"x":{"summary":"short channel note, no numbers","items":[["short post idea","Draft"]]},"linkedin":{"summary":"short channel note, no numbers","items":[["short post idea","Review"]]},"articles":{"summary":"short channel note, no numbers","items":[["short article title","Open"]]}},"rankings":[{"pos":"#3","query":"short query","trend":"↑2"}]}
Give exactly 2 items per channel and 4 rankings, all specific to ${p.name}. Keep it short so the JSON is complete.`
      ).then((t) => {
        try {
          const ins = parseJSON(t);
          if (ins.feed) genFeed = ins.feed as Record<string, FeedEntry>;
          if (Array.isArray(ins.rankings)) setRankings(ins.rankings as Ranking[]);
        }
        catch { setRankings([]); }
      }).catch(() => { setRankings([]); });

      const trafP = ai(
        `Estimate realistic MONTHLY Google Search numbers for the website ${u} (${p.name} — ${p.oneLiner}). Consider how well-known and large the site is.
Output ONLY this JSON, nothing else: {"impressions":<integer>,"clicks":<integer>,"visits":<integer>}`
      ).then((t) => {
        try { const tt = parseJSON(t); if (typeof tt.impressions === "number" && tt.impressions > 0) setEstTraffic({ impressions: tt.impressions, clicks: tt.clicks || 0, visits: tt.visits || 0 }); else setEstTraffic(null); }
        catch { setEstTraffic(null); }
      }).catch(() => setEstTraffic(null));

      await Promise.allSettled([insP, trafP]);
      // Honest numbers only: the feed shown, the counts spoken, and the dataset logged
      // all come from the same real items — no invented "36 opportunities" copy.
      const finalFeed = withHonestSummaries(normalizeFeed(genFeed ?? undefined, p, u));
      setFeed(finalFeed);
      logRecBatch(u, p, finalFeed).then((ids) => { if (Object.keys(ids).length) setRecIds(ids); });
      setDocCache({});
      const chCount = Object.keys(finalFeed).length;
      const total = Object.values(finalFeed).reduce((n, e) => n + (e.items?.length || 0), 0);
      const top = Object.entries(finalFeed).sort((a, b) => (b[1].items?.length || 0) - (a[1].items?.length || 0))[0];
      const firstItem = top?.[1]?.items?.[0]?.[0];
      setChat([
        { who: "ai", text: `Morning. I analyzed ${p.name || hostOf(u)} — ${chCount} agents reported in.` },
        { who: "ai", text: `Headline: ${total} opportunities across ${chCount} channels.${firstItem ? ` Highest expected impact: "${firstItem}" — start there.` : " Start with the feed below."}` },
      ]);
      bump(5); setDemo(false); setEntered(true);
    } catch (e) {
      setProgress(-1);
      setDemo(false);
      showToast(`Analysis failed: ${aiErrorText(e ?? lastErr).slice(0, 180)}`);
    }
  }, [inputUrl, source, sourceDesc]);

  /* ---- agent work item ---- */
  async function workItem(agentId: string, idx: number, item: string, agentName: string) {
    const key = agentId + ":" + idx;
    setBusyItem(key);
    let body: string;
    try {
      const brand = profile?.name || hostOf(url) || "the site";
      const oneLiner = profile?.oneLiner || "this product";
      const voice = profile?.voice || "clear, practical, specific";
      const context = `Website: ${url || "unknown"}\nBrand: ${brand}\nSummary: ${oneLiner}\nVoice: ${voice}`;
      const channelBrief: Record<string, string> = {
        hn: `Write a Show HN launch post for ${brand}. Use the brand name ${brand}, never Populr, unless ${brand} itself is Populr. State a concrete problem, how the product works, technical or product decisions, and honest limitations. Avoid hype, marketing clichés, and unsupported claims.`,
        linkedin: `Write a polished LinkedIn post for a founder or operator at ${brand}. Use the brand name ${brand}, never Populr, unless ${brand} itself is Populr. Start with a specific insight, support it with a concrete example, and end without a hard sell.`,
        reddit: `Write a high-signal Reddit reply or post for ${brand}. Sound helpful, specific, and non-promotional.`,
        x: `Write a concise X post or thread starter for ${brand}.`,
        seo: `Write an SEO deliverable for ${brand}.`,
        geo: `Write an AI-search / GEO deliverable for ${brand}.`,
        articles: `Write a long-form article brief or outline for ${brand}.`,
      };
      body = await ai(`You are the ${agentName} inside Populr.\n${context}\n${channelBrief[agentId] || ""}\nWork item: ${item}\nGround the deliverable in the real page details above. Produce the complete, ready-to-use deliverable. No preamble — just the deliverable.`, url);
      setDemo(false);
    } catch (e) {
      showToast(`AI request failed: ${aiErrorText(e).slice(0, 160)}`);
      setBusyItem("");
      return;
    }
    setBusyItem("");
    setDrafts((d) => [...d, { id: key + ":" + Date.now(), title: item, channel: agentId, body, approved: false, recId: recIds[key] }]);
    setDoc({ title: item, body });
    logRecEvent(recIds[key], "drafted", { title: item, body, channel: agentId });
  }

  /* ---- docs ---- */
  async function openDoc(id: string, name: string) {
    if (docCache[id]) { setDoc({ title: name, body: docCache[id] }); return; }
    if (!profile || demo) { setDoc({ title: name, body: DOC_DEMO[id] || "—" }); return; }
    setDoc({ title: name, body: "…generating…" });
    try {
      const body = await ai(`You are Populr, the AI CMO for ${profile.name} (${profile.oneLiner}). Voice: ${profile.voice}. Audience: ${profile.audience}.\nWrite the document "${name}" for this company, grounded in the real page details above. Be specific and practical. Use plain text with short sections. No preamble.`, url);
      setDocCache((c) => ({ ...c, [id]: body }));
      setDoc({ title: name, body });
    } catch (e) {
      setDoc({ title: name, body: `AI request failed: ${aiErrorText(e).slice(0, 200)}` });
    }
  }

  /* ---- chat ---- */
  async function sendChat() {
    const q = chatInput.trim(); if (!q) return;
    setChatInput(""); setChat((c) => [...c, { who: "me", text: q }]); setTyping(true);
    let reply: string;
    try {
      const prompt = buildChatPrompt({
        profile,
        url,
        competitors,
        feed,
        rankings,
        drafts,
        estTraffic,
        gscData,
        recentTurns: chat,
        question: q,
        mode: chatMode,
      });
      reply = await ai(prompt, url);
      setDemo(false);
    } catch (e) {
      reply = `AI request failed: ${aiErrorText(e).slice(0, 200)}`;
    }
    setTyping(false); setChat((c) => [...c, { who: "ai", text: reply }]);
  }

  function reset() {
    if (!confirm("Analyze a different website? Current session will be cleared.")) return;
    setEntered(false); setProfile(null); setInputUrl(""); setUrl(""); setProgress(-1);
    setChat([]); setDrafts([]); setCompetitors([]); setGscSite(""); setGscError(null); setFeed({}); setRankings([]); setDocCache({}); setEstTraffic(null); setRecIds({});
    try { localStorage.removeItem("cosmos.state"); } catch {}
  }

  const pendingDrafts = useMemo(() => drafts.filter((d) => !d.published), [drafts]);
  const approvedDrafts = useMemo(() => pendingDrafts.filter((d) => d.approved), [pendingDrafts]);

  const visibleAgents = useMemo(() => {
    const withWork = AGENTS.filter((a) => {
      const hasFeed = !!(feed[a.id]?.items?.length);
      const hasDrafts = pendingDrafts.some((d) => d.channel === a.id);
      return hasFeed || hasDrafts;
    });
    return withWork.length ? withWork : AGENTS.slice(0, 6);
  }, [feed, pendingDrafts]);

  async function togglePush() {
    if (!pushStatus?.configured || pushBusy) return;
    setPushBusy(true);
    try {
      if (pushStatus.subscribed) {
        await unsubscribePush();
        setPushStatus((p) => p ? { ...p, subscribed: false, prefs: { ...p.prefs, enabled: false } } : p);
        showToast("Reminders off");
      } else {
        const ok = await subscribePush(pushStatus.publicKey);
        if (ok) {
          const s = await fetchPushStatus();
          setPushStatus(s);
          showToast("Publish reminders on ✓");
        } else showToast("Couldn't enable — check browser permissions");
      }
    } finally { setPushBusy(false); }
  }

  function approveDraft(id: string) {
    // Use the UUID stamped on the draft at creation — never the current recIds map,
    // which may belong to a newer generation (mislinked events would corrupt the dataset).
    logRecEvent(drafts.find((d) => d.id === id)?.recId, "approved");
    setDrafts((ds) => ds.map((d) => d.id === id ? { ...d, approved: true, approvedAt: new Date().toISOString() } : d));
    showToast("Approved — we'll remind you at the right time");
  }

  function markPublished(id: string) {
    logRecEvent(drafts.find((d) => d.id === id)?.recId, "published");
    setDrafts((ds) => ds.map((d) => d.id === id ? { ...d, published: true } : d));
    showToast("Marked published");
  }

  function openDraft(d: Draft) {
    setDoc({ title: d.title, body: d.body });
  }

  const estimated = !gscData && !!estTraffic;
  const d = estTraffic ? buildEstData(estTraffic, range, url || "cosmos") : CHART[range];
  const contextualFeed = useMemo(() => buildFallbackFeed(profile, url), [profile, url]);
  const geoGaps = feed.geo?.items?.length ? feed.geo.items : contextualFeed.geo?.items || [];
  const suggestedQuestions = useMemo(() => {
    const brand = profile?.name || hostOf(url) || "this site";
    const oneLiner = profile?.oneLiner || "the product";
    return chatMode === "copy"
      ? [
          `Write a sharper homepage hero for ${brand}.`,
          `Draft a LinkedIn post announcing ${oneLiner}.`,
          `Turn the top draft into a stronger hook.`,
          `Rewrite the value prop so it sounds more premium.`,
        ]
      : [
          `What should we fix first for ${brand}?`,
          `Which channel has the highest leverage right now?`,
          `What would you pause this week?`,
          `What is the next best move based on today's data?`,
        ];
  }, [chatMode, profile, url]);

  /* ================= ONBOARDING ================= */
  if (!entered) {
    const steps = ["reading your site", "building product profile", "checking channels", "scoring opportunities", "writing today's plan"];
    return (
      <div className="appui">
        {accountsEnabled && !authUser && (
          <button className="authbtn" style={{ position: "fixed", top: 16, right: 16, zIndex: 5 }} onClick={() => setAuthOpen(true)}>Sign in</button>
        )}
        {authUser && (
          <span className="who" style={{ position: "fixed", top: 18, right: 18, zIndex: 5 }}><span className="whoemail">{authUser}</span><button className="lo" onClick={logout}>logout</button></span>
        )}
        {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
        <div className="onboard">
          <canvas className="dots" ref={dotsRef} aria-hidden="true" />
          <div className="ob-in">
            <span className="app-wordmark app-wordmark-lg">Populr.</span>
            <h1>What are we growing?</h1>
            <p className="s">
              {source === "website"
                ? <>Paste your website. Populr reads it, figures out your positioning, and builds today&apos;s plan.</>
                : <>No website needed — point Populr at where your business lives and it builds today&apos;s plan.</>}
            </p>
            <div className="urlbox">
              <input
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && analyze()}
                type={source === "website" ? "url" : "text"}
                placeholder={SOURCES.find((s) => s.id === source)?.placeholder}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="go" onClick={analyze} disabled={progress >= 0}>Analyze →</button>
            </div>
            {source !== "website" && (
              <div className="urlbox src-desc">
                <input
                  value={sourceDesc}
                  onChange={(e) => setSourceDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && analyze()}
                  type="text"
                  placeholder="what do you do? (optional)"
                  autoComplete="off"
                />
              </div>
            )}
            <div className="src-row" role="tablist" aria-label="What are you growing?">
              <span className="src-lead">grow a</span>
              {SOURCES.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && <span className="src-sep" aria-hidden="true">·</span>}
                  <button
                    role="tab"
                    aria-selected={source === s.id}
                    className={"src-opt" + (source === s.id ? " on" : "")}
                    onClick={() => { setSource(s.id); setInputUrl(""); }}
                  >
                    {s.label}
                  </button>
                </span>
              ))}
              <span style={{ whiteSpace: "nowrap" }}>
                <span className="src-sep" aria-hidden="true">·</span>
                <span className="src-soon">more soon</span>
              </span>
            </div>
            <p className="ob-note">read-only · nothing publishes without you</p>
            {progress >= 0 && (
              <div className="progress">
                {steps.map((s, i) => (
                  <div className={"pl" + (progress > i ? " done" : "")} key={i}>
                    {progress > i ? "● " : progress === i ? "◐ " : "○ "}{s}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ================= DASHBOARD ================= */
  return (
    <div className="appui">
      <div className={"appshell" + (termCollapsed ? " term-collapsed" : "")}>
        <div className="topbar">
          <div className="tb-l">
            <span className="app-wordmark">Populr.</span>
            <span className="sep">·</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>AI CMO Terminal · running daily</span>
          </div>
          <div className="tb-r">
            <a href="/app/campaigns" className="credits" style={{ textDecoration: "none", color: "inherit" }} title="Marketing Missions — your AI CMO assigns work">missions ↗</a>
            <a href="/worked" className="credits" style={{ textDecoration: "none", color: "inherit" }} title="Recommendations ranked by measured outcome">worked ↗</a>
            <span className="credits">{cloud ? "cloud ✓" : "local"}</span>
            {authUser && (
              <button className="bell" onClick={() => setPlanOpen(true)} title="Today's posting plan">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9h17M8 3v3M16 3v3" /><path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
                </svg>
              </button>
            )}
            {authUser && pushStatus?.configured && (
              <button
                className={"bell" + (pushStatus.subscribed ? " on" : "")}
                onClick={togglePush}
                disabled={pushBusy}
                title={pushStatus.subscribed ? "Publish reminders on" : "Enable publish reminders"}
              >
                {pushStatus.subscribed ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.8 5.7 1.8 5.7H4.2S6 13.5 6 9z" />
                    <path d="M10.2 20a1.9 1.9 0 0 0 3.6 0" />
                    <circle cx="17.5" cy="6" r="2.4" fill="currentColor" stroke="none" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9a6 6 0 0 1 12 0c0 4.5 1.8 5.7 1.8 5.7H4.2S6 13.5 6 9z" />
                    <path d="M10.2 20a1.9 1.9 0 0 0 3.6 0" />
                    <path d="M4 3.5l16 17" opacity="0.85" />
                  </svg>
                )}
              </button>
            )}
            {authUser && liveTrial?.active && <a href="/account" className="trialchip">{liveTrial.daysLeft}d left</a>}
            {authUser ? (
              <span className="who"><span className="whoemail">{authUser}</span><button className="lo" onClick={logout}>logout</button></span>
            ) : accountsEnabled ? (
              <button className="authbtn" onClick={() => setAuthOpen(true)}>Sign in</button>
            ) : null}
            <a href="/account" className="avatar" title="Account">{(authUser?.[0] || hostOf(url)[0] || "c").toUpperCase()}</a>
          </div>
        </div>

        {demo && (
          <div className="banner">
            running on demo data — add a working AI key to <code>groq_key.txt</code> / <code>.env.local</code> for real output
          </div>
        )}

        <div className="termstrip">
          <button className="term-toggle" onClick={() => setTermCollapsed((v) => !v)}>{termCollapsed ? "[+] expand" : "[–] collapse"}</button>
          <div className="tlog" ref={tlogRef} />
        </div>

        <div className="dash">
          {/* COMPANY */}
          <div className={"col" + (mtab === "company" ? " mactive" : "")}>
            <div className="col-head"><span className="ct"><span className="ic">▤</span>Company</span><span className="ca"><button title="Reset" onClick={reset}>⚙</button></span></div>
            <div className="col-body">
              <p className="company-desc">{profile?.description || profile?.positioning || "—"}</p>
              <div className="sect">
                <span className="label">Documents</span>
                {DOCS.map((doc) => (
                  <button className="docrow" key={doc.id} onClick={() => openDoc(doc.id, doc.name)}>
                    <span className="di">{doc.icon}</span>{doc.name}
                    {doc.tag && <span className="new">NEW</span>}{doc.count && <span className="cnt">{doc.count}</span>}
                  </button>
                ))}
              </div>
              <div className="sect">
                <span className="label">Competitors</span>
                <p className="company-desc" style={{ marginBottom: 10 }}>
                  These names drive comparison pages, objection handling, and positioning. Populr keeps them tied to the current website instead of reusing stale defaults.
                </p>
                {competitors.length ? competitors.map((c) => (
                  <div className="comp-row" key={c.n}>
                    <span className="cdot" style={{ background: c.c + "22", border: `1px solid ${c.c}55`, color: c.c }}>●</span>
                    <span>{c.n}</span>
                  </div>
                )) : (
                  <div className="placeholder" style={{ marginTop: 0 }}>No competitor set yet. Re-run analysis to refresh the comparison set.</div>
                )}
              </div>
            </div>
          </div>

          {/* ANALYTICS */}
          <div className={"col" + (mtab === "analytics" ? " mactive" : "")}>
            <div className="col-head"><span className="ct"><span className="ic">∿</span>Analytics</span></div>
            <div className="tabs">
              {(["overview", "seo"] as const).map((t) => (
                <button key={t} className={"tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t === "overview" ? "Overview" : "SEO"}</button>
              ))}
            </div>
            <div className="col-body">
              {gsc.configured && authUser && !gsc.connected && (
                <a href="/api/google/connect" className="gsc-card">
                  <span className="gsc-ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="6.4" /><path d="M15.8 15.8L20 20" /><path d="M8.6 13.2v-2M11 13.2V8.8M13.4 13.2v-3.1" /></svg>
                  </span>
                  <span className="gsc-txt">
                    <strong>Connect Google Search Console</strong>
                    <span>Real impressions, clicks, queries — powers analytics and smarter publish timing.</span>
                  </span>
                  <span className="gsc-go">Connect →</span>
                </a>
              )}
              {gsc.connected && gsc.sites.length === 0 && (
                <div className="gsc-card" style={{ cursor: "default", borderColor: "rgba(232,180,90,.3)" }}>
                  <span className="gsc-ic" style={{ background: "rgba(232,180,90,.12)", borderColor: "rgba(232,180,90,.28)", color: "var(--amberr)" }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 2.4 18a1.9 1.9 0 0 0 1.7 2.8h15.8a1.9 1.9 0 0 0 1.7-2.8L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" /></svg>
                  </span>
                  <span className="gsc-txt">
                    <strong>Connected — but no verified site</strong>
                    <span>This Google account owns no verified site in Search Console, so there&apos;s no data to pull. Showing an estimate instead.</span>
                  </span>
                  <a className="gsc-go" href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" style={{ background: "var(--amberr)" }}>Verify a site →</a>
                </div>
              )}
              {gsc.connected && gsc.sites.length > 1 && (
                <div className="rangebar" style={{ marginBottom: 12 }}>
                  <span className="rlabel">Property</span>
                  <select className="sitesel" value={gscSite || gsc.sites[0]} onChange={(e) => setGscSite(e.target.value)}>
                    {gsc.sites.map((s) => <option key={s} value={s}>{displaySite(s)}</option>)}
                  </select>
                </div>
              )}
              <div className="rangebar">
                <span className="rlabel">Showing</span>
                <span className="pillset">
                  <button className={"rpill" + (range === "7d" ? " on" : "")} onClick={() => setRange("7d")}>Last 7 days</button>
                  <button className={"rpill" + (range === "30d" ? " on" : "")} onClick={() => setRange("30d")}>Last 30 days</button>
                </span>
              </div>

              {tab === "overview" && (
                <>
                  <div className="an-h">How people found you</div>
                  {gscData ? (
                    <div className="an-s">Live · {displaySite(gscData.site)}</div>
                  ) : gsc.connected && gsc.sites.length === 0 ? (
                    <div className="an-s">Connected — no verified site, showing an estimate for {hostOf(url)}</div>
                  ) : gscError ? (
                    <div className="an-s">Search Console data did not load ({gscError}). Showing estimates for now.</div>
                  ) : gsc.connected ? (
                    <div className="an-s">Loading Search Console…</div>
                  ) : estimated ? (
                    <div className="an-s">Estimated for {hostOf(url)} — connect Search Console for exact numbers</div>
                  ) : (
                    <div className="an-s">Sample figures — connect Search Console for live data</div>
                  )}
                  <div className="statgrid">
                    <div className="statrow">
                      {gscData ? (
                        <>
                          <div className="stat"><div className="sl">Impressions</div><div className="sv">{gscData.impressions}</div><div className="sd">{gscData.deltas.impressions}</div></div>
                          <div className="stat"><div className="sl">Clicks</div><div className="sv">{gscData.clicks}</div><div className="sd">{gscData.deltas.clicks}</div></div>
                          <div className="stat"><div className="sl">Click rate</div><div className="sv">{gscData.ctr}</div><div className="sd">{gscData.deltas.ctr}</div></div>
                        </>
                      ) : (
                        <>
                          <div className="stat"><div className="sl">Saw you in Google</div><div className="sv">{d.saw}</div><div className="sd">↗ {d.sawD}</div></div>
                          <div className="stat"><div className="sl">Clicked through</div><div className="sv">{d.clicked}</div><div className="sd">↗ {d.clickedD}</div></div>
                          <div className="stat"><div className="sl">Visited your site</div><div className="sv">{d.visited}</div><div className="sd">↗ {d.visitedD}</div></div>
                        </>
                      )}
                    </div>
                    <div className="statfoot">
                      {gscData
                        ? <><span>avg. position <b>{gscData.position}</b> ({gscData.deltas.position})</span><span>vs prior {range === "7d" ? "7" : "30"} days</span></>
                        : estimated
                          ? <><span><b>{((estTraffic!.clicks / Math.max(estTraffic!.impressions, 1)) * 100).toFixed(1)}%</b> click rate</span><span>AI-estimated</span></>
                          : <><span>example data — not your traffic</span><span>connect Search Console for real numbers</span></>}
                    </div>
                  </div>
                  <div className="sect">
                    <div className="an-h">{gscData ? "Impressions & clicks" : "Traffic over time"}</div>
                    <div className="chartbox">
                      <Chart
                        labels={gscData ? gscData.series.labels : d.labels}
                        primary={gscData ? gscData.series.impressions : d.visits}
                        secondary={gscData ? gscData.series.clicks : d.clicks}
                      />
                    </div>
                    <div className="legend"><span><i />{gscData ? "Impressions" : "Visits"}</span><span className="l2"><i />{gscData ? "Clicks" : "Search clicks"}</span></div>
                  </div>
                  {geoGaps.length > 0 && (
                    <div className="sect">
                      <div className="an-h">AI search visibility</div>
                      <div className="an-s">Citation gaps from your GEO agent</div>
                      {geoGaps.slice(0, 3).map(([t], i) => (
                        <div className="georow" key={i}><span className="geodot" />{t}</div>
                      ))}
                    </div>
                  )}
                  <div className="sect">
                    <div className="an-h">Top queries</div>
                    <div style={{ marginTop: 8 }}>
                      {(gscData ? gscData.queries.slice(0, 5) : (rankings.length ? rankings : FALLBACK_RANKS).slice(0, 5)).map((r, i) => (
                        <div className="rankrow" key={i}><span className="rankpos">{r.pos}</span><span className="rq">{r.query}</span><span className="rt">{r.trend}</span></div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {tab === "seo" && (
                <>
                  {!gscData ? (
                    <div className="placeholder"><b style={{ color: "var(--dim)" }}>SEO details</b><br /><span className="mono" style={{ fontSize: 11 }}>Connect Search Console to see queries, pages, and CTR fixes</span></div>
                  ) : (
                    <>
                      <div className="an-h">Top queries</div>
                      <div className="an-s">Position trends vs prior period</div>
                      <div style={{ marginTop: 8 }}>
                        {gscData.queries.map((r, i) => (
                          <div className="rankrow" key={i}>
                            <span className="rankpos">{r.pos}</span>
                            <span className="rq">{r.query}</span>
                            <span className="rt">{r.trend}</span>
                          </div>
                        ))}
                      </div>
                      {gscData.pages.length > 0 && (
                        <div className="sect">
                          <div className="an-h">Low CTR pages</div>
                          <div className="an-s">High impressions but underperforming — quick wins</div>
                          {gscData.pages.map((p, i) => (
                            <div className="pagerow" key={i}>
                              <span className="pgpath">{p.page}</span>
                              <span className="pgmeta">{p.impressions} imp · {p.ctr} CTR · #{p.position}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* AGENTS FEED */}
          <div className={"col" + (mtab === "agents" ? " mactive" : "")}>
            <div className="col-head">
              <span className="ct"><span className="ic">≋</span>Agents Feed</span>
              {pendingDrafts.length > 0 && <span className="draftbadge">{pendingDrafts.length}</span>}
            </div>
            <div className="col-body">
              {pendingDrafts.length > 0 && (
                <div className="pubqueue">
                  <div className="pq-head">
                    <span className="label">Publish queue</span>
                    <span className="pq-sub">{approvedDrafts.length} approved · {pendingDrafts.length - approvedDrafts.length} awaiting review</span>
                  </div>
                  {pendingDrafts.slice(0, 6).map((dr) => (
                    <div className="pq-item" key={dr.id}>
                      <div className="pq-main">
                        <span className="pq-ch">{(CHANNEL_LABELS as Record<string, string>)[dr.channel] || dr.channel}</span>
                        <span className="pq-title">{dr.title}</span>
                      </div>
                      <span className="pq-acts">
                        {!dr.approved && <button className="go2 go2-pri" onClick={() => approveDraft(dr.id)}>Approve</button>}
                        <button className="go2 go2-sec" onClick={() => openDraft(dr)}>View</button>
                        {dr.approved && <button className="go2 go2-pri" onClick={() => markPublished(dr.id)}>Published ✓</button>}
                      </span>
                    </div>
                  ))}
                  {(["linkedin", "x", "reddit", "hn", "articles"] as PublishChannel[]).map((ch) => (
                    <div className="pq-window" key={ch}>{formatWindowLabel(ch)}</div>
                  ))}
                </div>
              )}
              {visibleAgents.map((a) => {
                const fe = feed[a.id];
                const items = fe?.items?.length ? fe.items : contextualFeed[a.id]?.items || a.items;
                const draftN = pendingDrafts.filter((d) => d.channel === a.id).length;
                return (
                <div className={"agent" + (open[a.id] ? " open" : "")} key={a.id}>
                  <button className="agent-head" onClick={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}>
                    <span className="aico" style={{ ["--ac" as string]: a.color } as React.CSSProperties}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{a.icon}</svg>
                    </span>
                    <span><div className="an">{a.name}</div><div className="as">{fe?.summary || a.sum}</div></span>
                    {draftN > 0 && <span className="abadge">{draftN}</span>}
                    <span className="chev">▾</span>
                  </button>
                  {open[a.id] && (
                    <div className="agent-body">
                      {items.map(([t, act], i) => (
                        <div className="aitem" key={i}><span>{t}</span>
                          <button className="go2 go2-pri" disabled={busyItem === a.id + ":" + i} onClick={() => workItem(a.id, i, t, a.name)}>
                            {busyItem === a.id + ":" + i ? "…" : act}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>

          {/* CHAT */}
          <div className={"col" + (mtab === "chat" ? " mactive" : "")}>
            <div className="col-head"><span className="ct"><span className="ic">◍</span>Talk to AI CMO</span></div>
            <div className="col-body chat-body" ref={chatBodyRef}>
              <div className="chat-tools">
                <div className="chat-mode" role="tablist" aria-label="Chat mode">
                  <button type="button" className={chatMode === "strategy" ? "on" : ""} onClick={() => setChatMode("strategy")}>Strategy</button>
                  <button type="button" className={chatMode === "copy" ? "on" : ""} onClick={() => setChatMode("copy")}>Copy</button>
                </div>
                <span className="chat-hint">{chatMode === "copy" ? "Draft-first mode" : "Decision mode"}</span>
              </div>
              <div className="chat-chips" aria-label="Suggested prompts">
                {suggestedQuestions.map((s) => (
                  <button key={s} type="button" className="chat-chip" onClick={() => setChatInput(s)}>{s}</button>
                ))}
              </div>
              {chat.map((m, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <span className={"msg-meta" + (m.who === "me" ? " me" : "")}>{m.who === "me" ? "you" : "AI CMO"}</span>
                  <div className={"msg " + m.who}>{m.text}</div>
                </div>
              ))}
              {typing && <span className="typing">AI CMO is thinking…</span>}
            </div>
            <div className="chat-foot">
              <div className="chatbox">
                <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()} placeholder="Ask me anything…" autoComplete="off" />
                <button className="send" onClick={sendChat} aria-label="Send">↑</button>
              </div>
            </div>
          </div>
        </div>

        <div className="mobilenav">
          {([
            ["company", "▤", "Company"],
            ["analytics", "∿", "Analytics"],
            ["agents", "≋", "Agents"],
            ["chat", "◍", "Chat"],
          ] as const).map(([id, ic, label]) => (
            <button key={id} className={mtab === id ? "on" : ""} onClick={() => setMtab(id)}>
              <span className="mi">{ic}</span>{label}
            </button>
          ))}
        </div>
      </div>

      {doc && (
        <div className="docwrap" onClick={(e) => { if (e.target === e.currentTarget) setDoc(null); }}>
          <div className="docpanel">
            <div className="doc-head">
              <span className="dt">{doc.title}</span>
              <button onClick={() => { navigator.clipboard?.writeText(doc.body).then(() => showToast("Copied")); }}>⧉ copy</button>
              <button onClick={() => setDoc(null)}>✕</button>
            </div>
            <div className="doc-body">{doc.body}</div>
          </div>
        </div>
      )}
      {mustSignIn && !authOpen && (
        <div className="trial-lock">
          <div className="trial-lock-card">
            <span className="app-wordmark app-wordmark-lg">Populr.</span>
            <h2>Sign in to continue</h2>
            <p>Create a free account to save your analysis and keep using Populr. Your work carries over.</p>
            <button className="acct-btn pri" style={{ marginTop: 18 }} onClick={() => setAuthOpen(true)}>Sign in / Create account</button>
          </div>
        </div>
      )}
      {verifyPopup && (
        <div className="authwrap" onClick={(e) => { if (e.target === e.currentTarget) setVerifyPopup(false); }}>
          <div className="authcard">
            <button className="xclose" onClick={() => setVerifyPopup(false)}>✕</button>
            <h3>Your website isn&apos;t verified yet</h3>
            <div className="authsub">Google Search Console only shares data for sites you&apos;ve verified ownership of — and this Google account doesn&apos;t have any yet. So we&apos;re showing <strong>estimated</strong> numbers for now.</div>
            <a className="submit" href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer" style={{ display: "block", textAlign: "center", textDecoration: "none" }}>Verify my site in Search Console →</a>
            <div className="toggle"><button onClick={() => setVerifyPopup(false)}>Continue with estimates</button></div>
          </div>
        </div>
      )}
      {planOpen && (() => {
        const sched = channelSchedule();
        const chColor = (ch: string) => AGENTS.find((a) => a.id === ch)?.color || "#CDA6F2";
        const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const today = new Date();
        const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(today.getDate() + i); return d; });
        const todayDow = today.getDay();
        const todayChannels = sched.filter((s) => s.days.includes(todayDow)).sort((a, b) => a.startHour - b.startHour);
        return (
          <div className="authwrap" onClick={(e) => { if (e.target === e.currentTarget) setPlanOpen(false); }}>
            <div className="plancard">
              <div className="plan-head">
                <div><strong>Content plan</strong><div className="plan-sub">What to post, at each channel&apos;s peak window</div></div>
                <button className="xclose" onClick={() => setPlanOpen(false)} aria-label="Close">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
              <div className="plan-week">
                {week.map((d, i) => {
                  const chs = sched.filter((s) => s.days.includes(d.getDay()));
                  return (
                    <div className={"plan-day" + (i === 0 ? " today" : "")} key={i}>
                      <div className="pd-dow">{DOW[d.getDay()]}</div>
                      <div className="pd-num">{d.getDate()}</div>
                      <div className="pd-dots">{chs.slice(0, 4).map((s) => <span key={s.channel} className="pd-dot" style={{ background: chColor(s.channel) }} />)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="plan-today">Today · {today.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</div>
              {todayChannels.length ? todayChannels.map((s) => {
                const item = feed[s.channel]?.items?.[0]?.[0];
                return (
                  <div className="plan-row" key={s.channel}>
                    <span className="plan-ch" style={{ color: chColor(s.channel) }}>●</span>
                    <div className="plan-info">
                      <div className="plan-line"><b>{s.label}</b><span className="plan-win">{s.window}</span></div>
                      <div className="plan-what">{item || `Draft a post for ${s.label}`}</div>
                    </div>
                    <button className="plan-go" onClick={() => { setPlanOpen(false); setMtab("agents"); setOpen((o) => ({ ...o, [s.channel]: true })); }}>Open</button>
                  </div>
                );
              }) : <div className="plan-empty">Nothing peaks today — a good day to plan ahead.</div>}
            </div>
          </div>
        );
      })()}
      {authOpen && <AuthModal onClose={() => { if (!mustSignIn) setAuthOpen(false); }} forced={mustSignIn} />}
      {authUser && liveTrial && !liveTrial.active && (
        <div className="trial-lock">
          <div className="trial-lock-card">
            <span className="app-wordmark app-wordmark-lg">Populr.</span>
            <h2>Your free month has ended</h2>
            <p>Upgrade to keep your AI CMO running. Your workspace, drafts, and connections are safe.</p>
            <button className="acct-btn pri" style={{ marginTop: 18 }} disabled title="Billing coming soon">Upgrade — $15/mo</button>
            <div className="trial-lock-foot">
              <a href="/account">Account</a>
              <span> · </span>
              <button onClick={logout}>Log out</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ---------- SVG traffic chart (generic: primary = filled line, secondary = dashed) ---------- */
function Chart({ labels, primary, secondary }: { labels: string[]; primary: number[]; secondary: number[] }) {
  const W = 560, H = 150, P = 10;
  const max = Math.max(...primary, 1) * 1.15;
  const denom = Math.max(primary.length - 1, 1);
  const pt = (arr: number[], i: number): [number, number] => [P + (i * (W - 2 * P)) / denom, H - P - ((arr[i] || 0) / max) * (H - 2 * P)];
  const line = (arr: number[]) => arr.map((_, i) => pt(arr, i).map((n) => n.toFixed(1)).join(",")).join(" ");
  const area = `${P},${H - P} ${line(primary)} ${W - P},${H - P}`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Traffic over time">
        <polygon points={area} fill="rgba(205,166,242,.10)" />
        <polyline points={line(primary)} fill="none" stroke="#CDA6F2" strokeWidth="2" />
        <polyline points={line(secondary)} fill="none" stroke="#55565E" strokeWidth="1.5" strokeDasharray="4 4" />
        {primary.map((_, i) => { const [x, y] = pt(primary, i); return <circle key={i} cx={x} cy={y} r="2.6" fill="#CDA6F2" />; })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'Geist Mono',monospace", fontSize: "9.5px", color: "var(--faint)", padding: "0 2px" }}>
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </>
  );
}

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

/* ---------- auth modal ---------- */
const AUTH_ERR: Record<string, string> = {
  email_taken: "That email is already registered — try signing in.",
  invalid_credentials: "Wrong email or password.",
  invalid_email: "Enter a valid email address.",
  weak_password: "Use at least 8 characters.",
  no_database: "Accounts aren't set up yet (no database connected).",
};

function AuthModal({ onClose, forced }: { onClose: () => void; forced?: boolean }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<{ google: boolean; facebook: boolean; x: boolean }>({ google: false, facebook: false, x: false });

  useEffect(() => {
    fetch("/api/auth/providers").then((r) => r.json()).then(setProviders).catch(() => {});
  }, []);
  const anySocial = providers.google || providers.facebook || providers.x;

  async function submit() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pw }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(AUTH_ERR[d.error] || d.hint || "Something went wrong."); setBusy(false); return; }
      // On signup, carry the anonymous workspace over so the just-analyzed site isn't lost.
      if (mode === "signup") {
        try {
          const local = localStorage.getItem("cosmos.state");
          if (local && JSON.parse(local)?.profile) {
            await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wsid: "migrate", state: JSON.parse(local) }) });
          }
        } catch { /* best-effort */ }
      }
      try { localStorage.removeItem("cosmos.nudgeDismissed"); } catch {}
      location.reload();
    } catch {
      setErr("Network error — try again."); setBusy(false);
    }
  }

  return (
    <div className="authwrap" onClick={(e) => { if (e.target === e.currentTarget && !forced) onClose(); }}>
      <div className="authcard">
        {!forced && <button className="xclose" onClick={onClose}>✕</button>}
        <h3>{mode === "signup" ? "Create your account" : "Welcome back"}</h3>
        <div className="authsub">{mode === "signup" ? "Save your workspace across devices." : "Sign in to your Populr workspace."}</div>
        {anySocial && (
          <div className="social">
            {providers.google && (
              <a className="social-btn" href="/api/auth/google">
                <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" /><path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.5 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 6.68 9.14 4.75 12 4.75z" /></svg>
                Continue with Google
              </a>
            )}
            {providers.facebook && (
              <a className="social-btn" href="/api/auth/facebook">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="#1877F2" aria-hidden="true"><path d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12z" /></svg>
                Continue with Facebook
              </a>
            )}
            {providers.x && (
              <a className="social-btn" href="/api/auth/x">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M17.2 3h3l-6.6 7.6L21.5 21h-6.1l-4.8-6.2L5.1 21h-3l7.1-8.1L2.5 3h6.2l4.3 5.7L17.2 3z" /></svg>
                Continue with X
              </a>
            )}
            <div className="social-or"><span>or</span></div>
          </div>
        )}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="you@company.com" autoComplete="email" />
        <label>Password</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={mode === "signup" ? "at least 8 characters" : "••••••••"} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        {err && <div className="autherr">{err}</div>}
        <button className="submit" onClick={submit} disabled={busy}>{busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}</button>
        <div className="toggle">
          {mode === "signup" ? "Already have an account? " : "New here? "}
          <button onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setErr(""); }}>
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}
