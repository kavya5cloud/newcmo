"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadState, saveState, type Saved, type Profile, type Draft, type ChatMsg, type FeedEntry, type Ranking } from "@/lib/store";

/* ---------- AI call (proxied through /api/generate) ---------- */
async function ai(prompt: string, url?: string): Promise<string> {
  const r = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, url: url || null }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(d.error || "api " + r.status);
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

/* ---------- static agent + doc definitions ---------- */
type AgentDef = { id: string; name: string; color: string; sum: string; items: [string, string][]; icon: React.ReactNode };
const AGENTS: AgentDef[] = [
  { id: "reddit", name: "Reddit Agent", color: "#FF4500", sum: "36 opportunities ready", items: [["Thread: \"tools for early-stage marketing?\" — high intent", "Draft reply"], ["Thread: \"is SEO dead in 2026?\" — position cosmos", "Draft reply"], ["Thread: \"AI CMO tools worth it?\" — direct match", "Draft reply"]], icon: <><ellipse cx="12" cy="14" rx="8" ry="5.6" /><circle cx="19.5" cy="9.5" r="1.6" /><path d="M12 8.4l1.2-4.2 4 1.1" strokeLinecap="round" /><circle cx="9" cy="13.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="13.5" r="1.1" fill="currentColor" stroke="none" /><path d="M9.3 16.3c1.7 1.1 3.7 1.1 5.4 0" strokeLinecap="round" /></> },
  { id: "geo", name: "GEO Agent", color: "#5A8DE8", sum: "11 citation gaps detected", items: [["Not cited for \"ai marketing automation\" in ChatGPT", "Fix gap"], ["Perplexity cites 2 competitors for your core query", "Fix gap"]], icon: <><circle cx="12" cy="12" r="8.4" /><ellipse cx="12" cy="12" rx="3.6" ry="8.4" /><path d="M3.8 12h16.4" /></> },
  { id: "seo", name: "SEO Agent", color: "#CDA6F2", sum: "46 recommendations ready", items: [["12 pages missing meta descriptions", "Review"], ["Keyword gap: \"marketing copilot\" — 2.1k/mo, low difficulty", "Draft post"]], icon: <><circle cx="11" cy="11" r="6.2" /><path d="M15.6 15.6L20 20" /><path d="M8.5 11h5M11 8.5v5" /></> },
  { id: "x", name: "X Agent", color: "#FAFAFA", sum: "137 ideas ready", items: [["Thread idea: \"we skipped 80% of our marketing tasks\"", "Draft"], ["Post: launch-week metrics recap", "Draft"]], icon: <path d="M17.2 3h3l-6.6 7.6L21.5 21h-6.1l-4.8-6.2L5.1 21h-3l7.1-8.1L2.5 3h6.2l4.3 5.7L17.2 3zm-1 16.2h1.7L6.9 4.7H5.1l11.1 14.5z" fill="currentColor" stroke="none" /> },
  { id: "articles", name: "Articles Agent", color: "#9A6AE8", sum: "32 topics ready", items: [["\"AI CMO vs marketing agency: real math\" — outline ready", "Open"], ["\"how to get cited by ChatGPT\" — research done", "Open"]], icon: <><path d="M4 20l1.2-4.2L16.4 4.6a2.05 2.05 0 0 1 2.9 2.9L8.2 18.8 4 20z" /><path d="M14.5 6.5l3 3" /></> },
  { id: "hn", name: "Hacker News Agent", color: "#FF6600", sum: "1 post ready", items: [["Show HN draft: \"Cosmos — an AI CMO that says no\"", "Review"]], icon: <><rect x="3" y="3" width="18" height="18" rx="3.5" /><path d="M8.3 7.5l3.7 5.2v4M15.7 7.5L12 12.7" strokeWidth="1.9" strokeLinecap="round" /></> },
  { id: "linkedin", name: "LinkedIn Agent", color: "#0A66C2", sum: "3 posts ready", items: [["Founder post: why we skip most marketing tasks", "Review"]], icon: <><rect x="3" y="3" width="18" height="18" rx="3.5" /><circle cx="8" cy="8.3" r="1.25" fill="currentColor" stroke="none" /><path d="M8 11.2v6" strokeWidth="2" strokeLinecap="round" /><path d="M12.2 17.2v-6" strokeWidth="2" strokeLinecap="round" /><path d="M12.2 13.6a2.5 2.5 0 0 1 5 0v3.6" strokeWidth="2" strokeLinecap="round" /></> },
  { id: "ugc", name: "UGC Videos Agent", color: "#E8843A", sum: "1 video · 1 completed", items: [["15s product clip — ready to preview", "Preview"]], icon: <><rect x="2.8" y="4.8" width="18.4" height="14.4" rx="3" /><path d="M10.2 9.2l4.6 2.8-4.6 2.8V9.2z" fill="currentColor" stroke="none" /></> },
  { id: "infl", name: "Influencer Campaigns", color: "#3ECF8E", sum: "Launch your first campaign", items: [["23 creators scored for audience fit", "Open list"]], icon: <path d="M20 4L7 8.5H4.5A2.5 2.5 0 0 0 2 11v2a2.5 2.5 0 0 0 2.5 2.5H6V19a1.5 1.5 0 0 0 1.5 1.5H9a1 1 0 0 0 1-1v-3.6l10 3.6V4z" /> },
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
  ["tl-p", "$ cosmos run --daily"],
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

const FALLBACK_RANKS: Ranking[] = [
  { pos: "#3", query: "ai cmo tool", trend: "↑2" },
  { pos: "#7", query: "ai marketing agents", trend: "↑5" },
  { pos: "#11", query: "marketing automation for startups", trend: "↑1" },
  { pos: "#14", query: "seo agency alternative", trend: "new" },
];

const DOC_DEMO: Record<string, string> = {
  product: "# Product Information\n\nGenerated once cosmos analyzes your site with a live AI key.\nUntil then this is a placeholder describing your product, its core loop, and pricing.",
  compet: "# Competitor Analysis\n\nYour top competitors and how cosmos positions against them appear here after analysis.",
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
  const [docCache, setDocCache] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState("traffic");
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [doc, setDoc] = useState<{ title: string; body: string } | null>(null);
  const [toast, setToast] = useState("");
  const [termCollapsed, setTermCollapsed] = useState(false);
  const [demo, setDemo] = useState(false);
  const [progress, setProgress] = useState<number>(-1);
  const [busyItem, setBusyItem] = useState<string>("");
  const [chatInput, setChatInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [accountsEnabled, setAccountsEnabled] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const tlogRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const dotsRef = useRef<HTMLCanvasElement>(null);
  const hydrated = useRef(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };

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
        setEntered(true);
      }
      hydrated.current = true;
    })();
  }, []);

  /* ---- auth status ---- */
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { setAuthUser(d.user?.email || null); setAccountsEnabled(!!d.accountsEnabled); })
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    location.reload();
  }

  /* ---- persist whenever meaningful state changes ---- */
  useEffect(() => {
    if (!hydrated.current || !entered || !profile) return;
    const s: Saved = { url, profile, competitors, chat, drafts, feed, rankings, docs: docCache };
    saveState(s);
  }, [url, profile, competitors, chat, drafts, feed, rankings, docCache, entered]);

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
      if (i >= TERM_LINES.length) { el.insertAdjacentHTML("beforeend", '<div><span class="tl-p">cosmos@ai:~$</span> <span style="display:inline-block;width:7px;height:12px;background:var(--fg);vertical-align:-2px"></span></div>'); el.scrollTop = el.scrollHeight; return; }
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
    let u = inputUrl.trim(); if (!u) return;
    if (!/^https?:\/\//.test(u)) u = "https://" + u;
    setUrl(u); setProgress(0);
    const steps = 5;
    const bump = (n: number) => setProgress(n);
    try {
      bump(1);
      const txt = await ai(
        `Analyze the website ${u} using the page content above.\nRespond ONLY with JSON, no markdown fences, no preamble:\n{"name":"company name","oneLiner":"what it does in one sentence","audience":"who buys it","positioning":"2-sentence positioning summary","competitors":["3-4 names"],"voice":"3 adjectives for brand voice","description":"a 4-sentence company overview for a dashboard sidebar"}`,
        u
      );
      const p = parseJSON(txt) as Profile;
      bump(3);
      setProfile(p);
      const comps = (p.competitors || []).slice(0, 4).map((n, i) => ({ n, c: ["#E86A3A", "#5A8DE8", "#E8843A", "#9A6AE8"][i % 4] }));
      setCompetitors(comps);
      // Phase 2: generate a company-specific agents feed + search rankings
      try {
        const insTxt = await ai(
          `You are cosmos, an AI CMO for ${p.name} — ${p.oneLiner}. Audience: ${p.audience}. Competitors: ${(p.competitors || []).join(", ")}.
Output ONLY compact valid JSON (no markdown, no prose). Each item's first string is a specific, descriptive opportunity in 6-12 words. Exactly this shape:
{"feed":{"reddit":{"summary":"36 opportunities ready","items":[["short thread angle","Draft reply"]]},"seo":{"summary":"46 recommendations","items":[["short keyword or fix","Draft post"]]},"geo":{"summary":"11 citation gaps","items":[["short AI-search gap","Fix gap"]]},"x":{"summary":"137 ideas","items":[["short post idea","Draft"]]},"linkedin":{"summary":"3 posts ready","items":[["short post idea","Review"]]},"articles":{"summary":"32 topics ready","items":[["short article title","Open"]]}},"rankings":[{"pos":"#3","query":"short query","trend":"↑2"}]}
Give exactly 2 items per channel and 4 rankings, all specific to ${p.name}. Keep it short so the JSON is complete.`
        );
        const ins = parseJSON(insTxt);
        if (ins.feed) setFeed(ins.feed as Record<string, FeedEntry>);
        if (Array.isArray(ins.rankings)) setRankings(ins.rankings as Ranking[]);
      } catch {
        setFeed({}); setRankings([]);
      }
      setDocCache({});
      setChat([
        { who: "ai", text: `Morning. I ran the daily sweep on ${hostOf(u)} — 9 agents reported in.` },
        { who: "ai", text: "Headline: 36 Reddit opportunities, 11 AI-search citation gaps, and one pricing-page fix that beats everything else on expected impact. Start there." },
      ]);
      bump(5); setDemo(false); setEntered(true);
    } catch {
      const host = hostOf(u);
      setProfile({ name: host, oneLiner: "(demo mode — no AI key or quota)", audience: "early-stage teams", positioning: "Demo data shown. Add a working key to analyze for real.", competitors: ["—"], voice: "clear, direct, useful", description: "Cosmos is your AI CMO for teams who cannot afford a full marketing department. It researches opportunities, drafts content, and audits technical SEO across Reddit, LinkedIn, X, Hacker News and organic search — with every output queued for human review before anything goes live." });
      setCompetitors([{ n: "okara.ai", c: "#E86A3A" }, { n: "jasper.ai", c: "#5A8DE8" }, { n: "hubspot.com", c: "#E8843A" }]);
      setChat([{ who: "ai", text: `Ran on ${host} in demo mode — add a working AI key to get real analysis.` }]);
      setFeed({}); setRankings([]); setDocCache({});
      setDemo(true); setEntered(true);
    }
  }, [inputUrl]);

  /* ---- agent work item ---- */
  async function workItem(agentId: string, idx: number, item: string, agentName: string) {
    const key = agentId + ":" + idx;
    setBusyItem(key);
    let body: string;
    try {
      body = await ai(`You are the ${agentName} inside cosmos, the AI CMO for ${profile?.name} (${profile?.oneLiner}). Voice: ${profile?.voice}.\nWork item: ${item}\nProduce the complete, ready-to-use deliverable. No preamble — just the deliverable.`);
      setDemo(false);
    } catch {
      body = `[demo draft — no AI key/quota]\n\n${agentName} · deliverable for:\n"${item}"\n\nAdd a working key for a real draft.`;
      setDemo(true);
    }
    setBusyItem("");
    setDrafts((d) => [...d, { id: key + ":" + Date.now(), title: item, channel: agentId, body, approved: false }]);
    setDoc({ title: item, body });
  }

  /* ---- docs ---- */
  async function openDoc(id: string, name: string) {
    if (docCache[id]) { setDoc({ title: name, body: docCache[id] }); return; }
    if (!profile || demo) { setDoc({ title: name, body: DOC_DEMO[id] || "—" }); return; }
    setDoc({ title: name, body: "…generating…" });
    try {
      const body = await ai(`You are cosmos, the AI CMO for ${profile.name} (${profile.oneLiner}). Voice: ${profile.voice}. Audience: ${profile.audience}.\nWrite the document "${name}" for this company. Be specific and practical. Use plain text with short sections. No preamble.`);
      setDocCache((c) => ({ ...c, [id]: body }));
      setDoc({ title: name, body });
    } catch {
      setDoc({ title: name, body: DOC_DEMO[id] || "—" });
    }
  }

  /* ---- chat ---- */
  async function sendChat() {
    const q = chatInput.trim(); if (!q) return;
    setChatInput(""); setChat((c) => [...c, { who: "me", text: q }]); setTyping(true);
    let reply: string;
    try {
      reply = await ai(`You are the AI CMO for ${profile?.name} — ${profile?.oneLiner}. Audience: ${profile?.audience}. Voice: ${profile?.voice}.\nToday's context: 36 reddit opportunities, 11 AI-search citation gaps, 46 SEO recommendations, pricing page has 61% bounce.\nThe founder asks: "${q}"\nAnswer in 2-4 short sentences, specific and prioritized. No fluff.`);
      setDemo(false);
    } catch {
      reply = "Demo mode (no AI key/quota) — standing advice: fix the pricing page first, then close the top 3 AI-search citation gaps. Everything else this week is optional.";
      setDemo(true);
    }
    setTyping(false); setChat((c) => [...c, { who: "ai", text: reply }]);
  }

  function reset() {
    if (!confirm("Analyze a different website? Current session will be cleared.")) return;
    setEntered(false); setProfile(null); setInputUrl(""); setUrl(""); setProgress(-1);
    setChat([]); setDrafts([]); setCompetitors([]);
  }

  const d = CHART[range];

  /* ================= ONBOARDING ================= */
  if (!entered) {
    const steps = ["reading your site", "building product profile", "checking channels", "scoring opportunities", "writing today's plan"];
    return (
      <div className="appui">
        {accountsEnabled && !authUser && (
          <button className="authbtn" style={{ position: "fixed", top: 16, right: 16, zIndex: 5 }} onClick={() => setAuthOpen(true)}>Sign in</button>
        )}
        {authUser && (
          <span className="who" style={{ position: "fixed", top: 18, right: 18, zIndex: 5 }}>{authUser}<button className="lo" onClick={logout}>logout</button></span>
        )}
        {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
        <div className="onboard">
          <canvas className="dots" ref={dotsRef} aria-hidden="true" />
          <div className="ob-in">
            <img src="/logo.png" alt="cosmos.ai" style={{ height: 28, imageRendering: "pixelated" }} />
            <h1>What are we growing?</h1>
            <p className="s">Paste your website. Cosmos reads it, figures out your positioning, and builds today&apos;s plan.</p>
            <div className="urlbox">
              <input value={inputUrl} onChange={(e) => setInputUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && analyze()} type="url" placeholder="https://yourcompany.com" autoComplete="off" spellCheck={false} />
              <button className="go" onClick={analyze} disabled={progress >= 0}>Analyze →</button>
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
            <img src="/logo.png" alt="cosmos.ai" />
            <span className="sep">·</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>AI CMO Terminal · running daily</span>
          </div>
          <div className="tb-r">
            <span className="credits">{cloud ? "cloud ✓" : "local"}</span>
            {authUser ? (
              <span className="who">{authUser}<button className="lo" onClick={logout}>logout</button></span>
            ) : accountsEnabled ? (
              <button className="authbtn" onClick={() => setAuthOpen(true)}>Sign in</button>
            ) : null}
            <span className="avatar">{(authUser?.[0] || hostOf(url)[0] || "c").toUpperCase()}</span>
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
          <div className="col">
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
                {competitors.map((c) => (
                  <div className="comp-row" key={c.n}><span className="cdot" style={{ background: c.c + "22", border: `1px solid ${c.c}55`, color: c.c }}>●</span>{c.n}</div>
                ))}
              </div>
            </div>
          </div>

          {/* ANALYTICS */}
          <div className="col">
            <div className="col-head"><span className="ct"><span className="ic">∿</span>Analytics</span></div>
            <div className="tabs">
              {["traffic", "seo", "links", "technical", "geo"].map((t) => (
                <button key={t} className={"tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
            <div className="col-body">
              {tab !== "traffic" ? (
                <div className="placeholder"><b style={{ color: "var(--dim)" }}>{tab.toUpperCase()} view</b><br /><span className="mono" style={{ fontSize: 11 }}>connects to real data in a later phase</span></div>
              ) : (
                <>
                  <div className="rangebar">
                    <span className="rlabel">Showing</span>
                    <span className="pillset">
                      <button className={"rpill" + (range === "7d" ? " on" : "")} onClick={() => setRange("7d")}>Last 7 days</button>
                      <button className={"rpill" + (range === "30d" ? " on" : "")} onClick={() => setRange("30d")}>Last 30 days</button>
                    </span>
                  </div>
                  <div className="an-h">How people found you</div>
                  <div className="an-s">Sample figures — connect Google Search Console for live numbers</div>
                  <div className="statgrid">
                    <div className="statrow">
                      <div className="stat"><div className="sl">Saw you in Google</div><div className="sv">{d.saw}</div><div className="sd">↗ {d.sawD}</div></div>
                      <div className="stat"><div className="sl">Clicked through</div><div className="sv">{d.clicked}</div><div className="sd">↗ {d.clickedD}</div></div>
                      <div className="stat"><div className="sl">Visited your site</div><div className="sv">{d.visited}</div><div className="sd">↗ {d.visitedD}</div></div>
                    </div>
                    <div className="statfoot"><span><b>4.7%</b> click rate</span><span><b>4.1×</b> from other channels</span></div>
                  </div>
                  <div className="sect">
                    <div className="an-h">Traffic over time</div>
                    <div className="an-s">Visits vs. search clicks — last {range === "7d" ? "7" : "30"} days</div>
                    <div className="chartbox"><Chart data={d} /></div>
                    <div className="legend"><span><i />Visits</span><span className="l2"><i />Search clicks</span></div>
                  </div>
                  <div className="sect">
                    <div className="an-h">How well you&apos;re ranking</div>
                    <div className="an-s">Your position in Google and the queries bringing traffic</div>
                    <div style={{ marginTop: 10 }}>
                      {(rankings.length ? rankings : FALLBACK_RANKS).map((r) => (
                        <div className="rankrow" key={r.query}><span className="rankpos">{r.pos}</span><span className="rq">{r.query}</span><span className="rt">{r.trend}</span></div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* AGENTS FEED */}
          <div className="col">
            <div className="col-head"><span className="ct"><span className="ic">≋</span>Agents Feed</span></div>
            <div className="col-body">
              {AGENTS.map((a) => {
                const fe = feed[a.id];
                const items = fe?.items?.length ? fe.items : a.items;
                return (
                <div className={"agent" + (open[a.id] ? " open" : "")} key={a.id}>
                  <button className="agent-head" onClick={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}>
                    <span className="aico" style={{ ["--ac" as string]: a.color } as React.CSSProperties}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{a.icon}</svg>
                    </span>
                    <span><div className="an">{a.name}</div><div className="as">{fe?.summary || a.sum}</div></span>
                    <span className="chev">▾</span>
                  </button>
                  {open[a.id] && (
                    <div className="agent-body">
                      {items.map(([t, act], i) => (
                        <div className="aitem" key={i}><span>{t}</span>
                          <button className="go2" disabled={busyItem === a.id + ":" + i} onClick={() => workItem(a.id, i, t, a.name)}>
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
          <div className="col">
            <div className="col-head"><span className="ct"><span className="ic">◍</span>Talk to AI CMO</span></div>
            <div className="col-body chat-body" ref={chatBodyRef}>
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
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ---------- SVG traffic chart ---------- */
function Chart({ data }: { data: (typeof CHART)["7d"] }) {
  const W = 560, H = 150, P = 10;
  const max = Math.max(...data.visits) * 1.15;
  const pt = (arr: number[], i: number): [number, number] => [P + (i * (W - 2 * P)) / (arr.length - 1), H - P - (arr[i] / max) * (H - 2 * P)];
  const line = (arr: number[]) => arr.map((_, i) => pt(arr, i).map((n) => n.toFixed(1)).join(",")).join(" ");
  const area = `${P},${H - P} ${line(data.visits)} ${W - P},${H - P}`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Traffic over time">
        <polygon points={area} fill="rgba(205,166,242,.10)" />
        <polyline points={line(data.visits)} fill="none" stroke="#CDA6F2" strokeWidth="2" />
        <polyline points={line(data.clicks)} fill="none" stroke="#55565E" strokeWidth="1.5" strokeDasharray="4 4" />
        {data.visits.map((_, i) => { const [x, y] = pt(data.visits, i); return <circle key={i} cx={x} cy={y} r="2.6" fill="#CDA6F2" />; })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'Geist Mono',monospace", fontSize: "9.5px", color: "var(--faint)", padding: "0 2px" }}>
        {data.labels.map((l) => <span key={l}>{l}</span>)}
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

function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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
      location.reload();
    } catch {
      setErr("Network error — try again."); setBusy(false);
    }
  }

  return (
    <div className="authwrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="authcard">
        <button className="xclose" onClick={onClose}>✕</button>
        <h3>{mode === "signup" ? "Create your account" : "Welcome back"}</h3>
        <div className="authsub">{mode === "signup" ? "Save your workspace across devices." : "Sign in to your cosmos workspace."}</div>
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
