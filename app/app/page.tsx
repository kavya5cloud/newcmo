"use client";
import HomeHero from "./HomeHero";
import { FEED_SLOT_MS, feedIsFresh } from "@/lib/agent-feed";
import AccountConnections from "@/app/components/AccountConnections";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadState, saveState, workspaceId, type Saved, type Profile, type Draft, type ChatMsg, type FeedEntry, type Ranking } from "@/lib/store";
import { CHANNEL_LABELS, formatWindowLabel, channelSchedule, type PublishChannel } from "@/lib/publish-times";
import { matchGscSite, displaySite } from "@/lib/gsc-match";
import { fetchPushStatus, subscribePush, unsubscribePush, type PushStatus } from "@/lib/push-client";
import { AIProcessing } from "@/app/components/ai-processing";
import { extractJson, LlmJsonError } from "@/lib/llm-json";
import { isContentEnginePath } from "@/lib/flags";
import Icon from "@/app/components/Icon";
import Section from "@/app/components/Section";
import DocSkeleton from "@/app/components/DocSkeleton";
import { DELIVERABLE_RULES } from "@/lib/cmo/quality-rules";
import { ai, hostOf } from "./_lib/ai";
import { SOURCES, SOURCE_LABEL, canonicalSource, type SourceType } from "./_lib/sources";
import { logRecBatch, logRecEvent } from "./_lib/telemetry";
import { trialSnapshot } from "./_lib/trial";
import { buildFallbackFeed, normalizeFeed, withHonestSummaries } from "./_lib/feed";
import { AGENTS, DOCS, buildTermLines, normalizeProfile } from "./_lib/catalog";
import { CHART, buildEstData } from "./_lib/chart-data";
import { FALLBACK_RANKS, DOC_DEMO } from "./_lib/demo-data";
import { Chart } from "./_components/Chart";
import { AuthModal } from "./_components/AuthModal";
import { esc } from "./_lib/html";



/* ---------- component ---------- */
/** Where the user was heading before we asked them to sign in / paste their site. */
const NEXT_KEY = "populr:next";

/**
 * Only internal product paths. A `next` value arrives from the URL, so it is untrusted:
 * reject protocol-relative URLs (which leave the origin), traversal segments (which
 * resolve somewhere other than where they read), and anything outside /studio and /app.
 */
function isSafeNext(v: string): boolean {
  if (v.startsWith("//") || v.includes("..") || v.includes("\\")) return false;
  if (!/^\/(studio|app)(\/|$|\?)/.test(v)) return false;
  // A saved link or an old bookmark can still carry a content-engine destination. Sending
  // someone through sign-in only to bounce them off the far end is worse than ignoring the
  // hint and landing them on the dashboard.
  return !isContentEnginePath(v.split("?")[0]);
}

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
  /** When `feed` was generated. Undefined means it predates the rotation, so it reads as
   *  stale and the rotating board takes over — which is the correct result for the saved
   *  feeds that were freezing the dashboard. */
  const [feedAt, setFeedAt] = useState<number | undefined>(undefined);
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [estTraffic, setEstTraffic] = useState<{ impressions: number; clicks: number; visits: number } | null>(null);
  const [docCache, setDocCache] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"overview" | "seo">("overview");
  const [range, setRange] = useState<"7d" | "30d">("7d");
  const [gscSite, setGscSite] = useState<string>("");
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [doc, setDoc] = useState<{ title: string; body: string; loading?: boolean } | null>(null);
  // Real AI-search visibility. Null means "never checked" — which the panel says out loud,
  // because "not checked" and "checked, you were not named" are opposite facts and the old
  // hardcoded version could express neither.
  const [geo, setGeo] = useState<{ summary: string; items: [string, string][]; engine: string; checkedAt: number } | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
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
  const [navOpen, setNavOpen] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
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
  // Surface WHY it failed. A model that replies without JSON (or gets cut off) used to
  // surface as the useless "Unexpected end of JSON input" — now it says so plainly.
  const aiErrorText = (err: unknown) => {
    if (err instanceof LlmJsonError) {
      return err.reason === "no_json"
        ? "the site couldn't be read cleanly — try again, or use a different URL"
        : "the response was cut short — try again";
    }
    return err instanceof Error ? err.message : String(err);
  };
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
        setDrafts(saved.drafts || []); setFeed(saved.feed || {}); setFeedAt(saved.feedAt);
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

  // Once the workspace is genuinely usable — signed in where required, and a profile
  // exists — resume whatever the user originally clicked. Nothing is lost to the detour.
  useEffect(() => {
    if (!entered || !profile) return;
    if (accountsEnabled && !authUser) return;
    let target: string | null = null;
    try { target = sessionStorage.getItem(NEXT_KEY); } catch { target = null; }
    if (!target || !isSafeNext(target)) return;
    try { sessionStorage.removeItem(NEXT_KEY); } catch { /* ignore */ }
    setResuming(target);
    // A beat so the "brand understood" state is seen rather than flashing past.
    const timer = setTimeout(() => { window.location.assign(target!); }, 900);
    return () => clearTimeout(timer);
  }, [entered, profile, authUser, accountsEnabled]);

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
        connected: "Search Console connected",
        notconfigured: "Google isn't configured on the server yet",
        denied: "Connection cancelled",
        error: "Couldn't connect — try again",
        login: "Sign in first, then connect",
      };
      if (msg[p]) { setToast(msg[p]); setTimeout(() => setToast(""), 3000); }
      window.history.replaceState({}, "", "/app");
    }
    const qs = new URLSearchParams(window.location.search);
    const nxt = qs.get("next");
    if (nxt && isSafeNext(nxt)) {
      // Keep the user's intent across sign-in and website analysis. Only internal
      // product paths are accepted — a `next` from a URL is untrusted input.
      try { sessionStorage.setItem(NEXT_KEY, nxt); } catch { /* private mode */ }
    }
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
    const s: Saved = { url, profile, competitors, chat, drafts, feed, feedAt, rankings, docs: docCache, estTraffic, gscSite, recIds };
    saveState(s);
  }, [url, profile, competitors, chat, drafts, feed, feedAt, rankings, docCache, estTraffic, entered, demo, gscSite, recIds]);

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
    const host = hostOf(url) || "your site";
    const brand = profile?.name || host;
    const channels = (Object.keys(feed).length ? Object.keys(feed) : visibleAgents.map((a) => a.id));
    const lines = buildTermLines(brand, host, channels, visibleAgents.length);
    el.innerHTML = "";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { el.innerHTML = lines.map(([c, t]) => `<div class="${c}">${esc(t)}</div>`).join(""); return; }
    let i = 0; let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      if (!tlogRef.current) return;
      if (i >= lines.length) { el.insertAdjacentHTML("beforeend", '<div><span class="tl-p">populr@ai:~$</span> <span style="display:inline-block;width:7px;height:12px;background:var(--fg);vertical-align:-2px"></span></div>'); el.scrollTop = el.scrollHeight; return; }
      const [c, t] = lines[i++];
      el.insertAdjacentHTML("beforeend", `<div class="${c}">${esc(t)}</div>`); el.scrollTop = el.scrollHeight;
      timer = setTimeout(next, 240 + Math.random() * 260);
    };
    timer = setTimeout(next, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          // `description` is asked for last and is allowed to go missing.
          //
          // It is a four-sentence field on the end of a seven-key object, so it is the part
          // that gets cut when a response runs long — and a truncated JSON object is not a
          // partial profile, it is a parse failure. One flaky generation therefore blanked
          // the competitor list and the overview together, which is the symptom that got
          // reported. normalizeProfile now drops a malformed field instead of losing the
          // object, and a missing overview is repaired by its own call below.
          //
          // Newly worth guarding: the default model thinks before it answers, so part of the
          // output budget is spent before the first character of JSON is written.
          const txt = await ai(
            `Analyze ${subject} using the page content above.${srcNote}${descLine}\nRespond ONLY with JSON, no markdown fences, no preamble:\n{"name":"company name","oneLiner":"what it does in one sentence","audience":"who buys it","positioning":"2-sentence positioning summary","competitors":["3-4 real competitor company names"],"voice":"3 adjectives for brand voice","description":"a 4-sentence company overview for a dashboard sidebar"}`,
            source === "gbp" ? undefined : u
          );
          p = normalizeProfile(extractJson<Profile>(txt));
        } catch (e) { lastErr = e; }
      }
      if (!p) throw lastErr || new Error("profile_failed");
      bump(3);
      setProfile(p);
      const comps = (p.competitors || []).slice(0, 4).map((n, i) => ({ n, c: ["#E86A3A", "#5A8DE8", "#E8843A", "#9A6AE8"][i % 4] }));
      setCompetitors(comps);

      // Repair the overview only if it did not survive. Usually it does, and this costs
      // nothing; when it does not, one extra call beats a panel reading "—". Failing here
      // costs the overview alone — profile, competitors and feed are already set above, and
      // positioning stands in meanwhile.
      if (!p.description) {
        const brandForDesc = p.name;
        ai(`Write a four-sentence company overview of ${brandForDesc} for a dashboard sidebar, grounded in the page content above. What they sell, who buys it, and what makes them different. Plain prose, no headings, no bullets, no preamble. Never invent statistics, funding, headcount or customer names.`,
           source === "gbp" ? undefined : u)
          .then((desc) => {
            const clean = (desc || "").trim();
            if (clean) setProfile((prev) => (prev ? { ...prev, description: clean } : prev));
          })
          .catch(() => {});   // positioning already covers this slot
      }
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
          const ins = extractJson<{ feed?: Record<string, FeedEntry>; rankings?: Ranking[] }>(t);
          if (ins.feed) genFeed = ins.feed;
          if (Array.isArray(ins.rankings)) setRankings(ins.rankings);
        }
        catch { setRankings([]); }
      }).catch(() => { setRankings([]); });

      const trafP = ai(
        `Estimate realistic MONTHLY Google Search numbers for the website ${u} (${p.name} — ${p.oneLiner}). Consider how well-known and large the site is.
Output ONLY this JSON, nothing else: {"impressions":<integer>,"clicks":<integer>,"visits":<integer>}`
      ).then((t) => {
        try { const tt = extractJson<{ impressions?: number; clicks?: number; visits?: number }>(t); if (typeof tt.impressions === "number" && tt.impressions > 0) setEstTraffic({ impressions: tt.impressions, clicks: tt.clicks || 0, visits: tt.visits || 0 }); else setEstTraffic(null); }
        catch { setEstTraffic(null); }
      }).catch(() => setEstTraffic(null));

      await Promise.allSettled([insP, trafP]);
      // Honest numbers only: the feed shown, the counts spoken, and the dataset logged
      // all come from the same real items — no invented "36 opportunities" copy.
      const finalFeed = withHonestSummaries(normalizeFeed(genFeed ?? undefined, p, u, Date.now()));
      setFeed(finalFeed);
      setFeedAt(Date.now());
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
    // Open the panel on the press.
    //
    // This used to wait for the whole generation, so a press changed one button caption to
    // "…" and nothing else for ten or twenty seconds — long enough to read as a dead click
    // and press again. The work takes as long as it takes; what was missing was any evidence
    // it had started.
    setDoc({ title: item, body: "", loading: true });
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
      // The same rules the server-side engines carry. Without them this path — the one that
      // writes the posts a customer actually publishes — was the only one with nothing
      // stopping it inventing a statistic.
      body = await ai(`You are the ${agentName} inside Populr.\n${context}\n${channelBrief[agentId] || ""}\nWork item: ${item}\nGround the deliverable in the real page details above. Produce the complete, ready-to-use deliverable. No preamble — just the deliverable.\n\n${DELIVERABLE_RULES}`, url);
      setDemo(false);
    } catch (e) {
      showToast(`AI request failed: ${aiErrorText(e).slice(0, 160)}`);
      setBusyItem("");
      setDoc(null);   // the panel opened optimistically; take it away rather than leave it spinning
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
    setDoc({ title: name, body: "", loading: true });
    try {
      const body = await ai(`You are Populr, the AI CMO for ${profile.name} (${profile.oneLiner}). Voice: ${profile.voice}. Audience: ${profile.audience}.\nWrite the document "${name}" for this company, grounded in the real page details above. Be specific and practical. Use plain text with short sections. No preamble.\n\n${DELIVERABLE_RULES}`, url);
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
    let intent = "strategy";
    try {
      // The server owns classification, evidence retrieval, deterministic decision-making,
      // and rendering. The browser sends the founder's request, never an assembled prompt.
      const recentTurns = chat.slice(-6).map((m) => `${m.who === "me" ? "Founder" : "CMO"}: ${m.text}`).join("\n");
      const lastAi = [...chat].reverse().find((m) => m.who === "ai")?.text || "";
      const r = await fetch("/api/cmo/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wsid: workspaceId(), url, profile, question: q, recentTurns, source: lastAi, hasSelection: !!lastAi }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.text) throw new Error(d.error || "cmo response failed");
      reply = d.text as string;
      intent = d.intent || "strategy";
      setDemo(false);
    } catch (e) {
      reply = `AI request failed: ${aiErrorText(e).slice(0, 200)}`;
    }
    setTyping(false); setChat((c) => [...c, { who: "ai", text: reply, intent }]);
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
          showToast("Publish reminders on");
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
  // Keyed on the 12-hour slot so the board turns over twice a day, and so a reload inside
  // a slot shows the same list rather than reshuffling under the reader.
  const slot = Math.floor(Date.now() / FEED_SLOT_MS);
  // Whether the generated feed is still inside its slot. Depends on `slot` so it is
  // re-evaluated when the board is due to turn over.
  const fresh = useMemo(() => feedIsFresh(feedAt), [feedAt, slot]);
  const contextualFeed = useMemo(() => buildFallbackFeed(profile, url), [profile, url, slot]);
  const geoGaps = feed.geo?.items?.length ? feed.geo.items : contextualFeed.geo?.items || [];

  // Read-only: GET never triggers a check, so opening the dashboard costs nothing.
  useEffect(() => {
    fetch("/api/geo", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.report) {
          setGeo({ summary: d.summary, items: d.items, engine: d.report.engine, checkedAt: d.report.checkedAt });
        }
      })
      .catch(() => {});   // an absent panel beats a broken one
  }, []);

  async function runGeoCheck() {
    if (geoBusy || !profile) return;
    setGeoBusy(true);
    try {
      const r = await fetch("/api/geo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: profile.name, host: hostOf(url),
          category: profile.oneLiner, audience: profile.audience,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.report) { showToast(d.hint || "Couldn't run the check right now"); return; }
      setGeo({ summary: d.summary, items: d.items, engine: d.report.engine, checkedAt: d.report.checkedAt });
      showToast(d.summary);
    } catch {
      showToast("Couldn't reach the AI-search check");
    } finally {
      setGeoBusy(false);
    }
  }
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
                <span className="src-soon">more sources in early access</span>
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
            <span className="mono" style={{ fontSize: 11, color: "var(--dim)" }}>{profile?.name ? `${profile.name} · AI CMO` : hostOf(url) ? `${hostOf(url)} · AI CMO` : "AI CMO Terminal"}</span>
          </div>
          <div className="tb-r">
            <a href="/app/campaigns" className="credits" style={{ textDecoration: "none", color: "inherit" }} title="Marketing Missions — your AI CMO assigns work">missions ↗</a>
            <a href="/worked" className="credits" style={{ textDecoration: "none", color: "inherit" }} title="Recommendations ranked by measured outcome">worked ↗</a>
            <span className="credits">{cloud ? "cloud" : "local"}</span>
            {authUser && (
              <button className="bell" onClick={() => setPlanOpen(true)} title="Today's posting plan">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9h17M8 3v3M16 3v3" /><path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
                </svg>
              </button>
            )}
            {authUser && pushStatus?.configured && (
              <button
                className={"bell bell-push" + (pushStatus.subscribed ? " on" : "")}
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
            <button className="tb-burger" onClick={() => setNavOpen((v) => !v)} aria-label="Menu" aria-expanded={navOpen}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
          </div>
          {navOpen && (
            <>
              <div className="tb-scrim" onClick={() => setNavOpen(false)} />
              <div className="tb-drop" role="menu">
                <a href="/app/campaigns" role="menuitem">Marketing Missions</a>
                <a href="/worked" role="menuitem">What actually worked</a>
                <button role="menuitem" onClick={() => { setNavOpen(false); setPlanOpen(true); }}>Today&apos;s posting plan</button>
                {authUser && pushStatus?.configured && (
                  <button role="menuitem" onClick={() => { togglePush(); }} disabled={pushBusy}>
                    Publish reminders: {pushStatus.subscribed ? "on" : "off"}
                  </button>
                )}
                <span className="tb-drop-status">{cloud ? "cloud" : "local"}{liveTrial?.active ? ` · ${liveTrial.daysLeft}d trial left` : ""}</span>
                {authUser ? (
                  <button role="menuitem" onClick={() => { setNavOpen(false); logout(); }}>Log out</button>
                ) : accountsEnabled ? (
                  <button role="menuitem" onClick={() => { setNavOpen(false); setAuthOpen(true); }}>Sign in</button>
                ) : null}
              </div>
            </>
          )}
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

        {/* The first thing, above everything else: is my marketing handled, and does
            anything need me. The columns below are for anyone who wants to dig. */}
        <HomeHero company={profile?.name} />

        <div className="dash">
          {/* COMPANY */}
          <div className={"col" + (mtab === "company" ? " mactive" : "")}>
            <div className="col-head"><span className="ct">Company</span><span className="ca"><button title="Reset" aria-label="Reset" onClick={reset}><Icon name="gear" size={15} /></button></span></div>
            <div className="col-body">
              <p className="company-desc">{profile?.description || profile?.positioning || "—"}</p>
              <Section id="documents" label="Documents">
                {DOCS.map((doc) => (
                  <button className="docrow" key={doc.id} onClick={() => openDoc(doc.id, doc.name)}>
                    <span className="di"><Icon name={doc.icon} size={15} /></span>{doc.name}
                    {doc.tag && <span className="new">NEW</span>}{doc.count && <span className="cnt">{doc.count}</span>}
                  </button>
                ))}
              </Section>
              <Section id="competitors" label="Competitors" meta={competitors.length || null}>
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
              </Section>
            </div>
          </div>

          {/* ANALYTICS */}
          <div className={"col" + (mtab === "analytics" ? " mactive" : "")}>
            <div className="col-head"><span className="ct">Analytics</span></div>
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
                          {/* No growth arrows on sample figures.
                              The numbers are labelled as samples, but "↗ +48.2%" is not a
                              sample of anything — a shape can stand in for a real value, a
                              trend cannot stand in for a real trend. Someone skimming reads
                              the green arrow long before the caption above it, and leaves
                              believing their clicks rose by half. */}
                          <div className="stat"><div className="sl">Saw you in Google</div><div className="sv">{d.saw}</div><div className="sd sd-sample">sample</div></div>
                          <div className="stat"><div className="sl">Clicked through</div><div className="sv">{d.clicked}</div><div className="sd sd-sample">sample</div></div>
                          <div className="stat"><div className="sl">Visited your site</div><div className="sv">{d.visited}</div><div className="sd sd-sample">sample</div></div>
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
                  <Section id="traffic" label={gscData ? "Impressions & clicks" : "Traffic over time"} variant="head">
                    <div className="chartbox">
                      <Chart
                        labels={gscData ? gscData.series.labels : d.labels}
                        primary={gscData ? gscData.series.impressions : d.visits}
                        secondary={gscData ? gscData.series.clicks : d.clicks}
                      />
                    </div>
                    <div className="legend"><span><i />{gscData ? "Impressions" : "Visits"}</span><span className="l2"><i />{gscData ? "Clicks" : "Search clicks"}</span></div>
                  </Section>
                  {geoGaps.length > 0 && (
                    <Section
                      id="geo"
                      label="AI search visibility"
                      variant="head"
                      sub={geo
                        ? `${geo.summary} · asked ${new Date(geo.checkedAt).toLocaleDateString()} via ${geo.engine}`
                        : "Ask an AI assistant what a buyer would ask, and see whether you come up"}
                    >
                      {/* Measured results when they exist; suggestions when they do not. The
                          two are never mixed, and neither is dressed as the other. */}
                      {(geo ? geo.items : geoGaps).slice(0, 3).map(([t], i) => (
                        <div className="georow" key={i}><span className="geodot" />{t}</div>
                      ))}
                      <button className="go2 geo-run" onClick={runGeoCheck} disabled={geoBusy || !profile}>
                        {geoBusy ? <span className="btn-spin" aria-label="Checking" /> : geo ? "Check again" : "Run the check"}
                      </button>
                      {!geo && (
                        <p className="geo-note">Nothing has been measured yet. This asks a model four buyer
                        questions about your category — never naming you — and reports whether you came up.</p>
                      )}
                    </Section>
                  )}
                  <Section id="queries" label="Top queries" variant="head">
                    <div style={{ marginTop: 8 }}>
                      {(gscData ? gscData.queries.slice(0, 5) : (rankings.length ? rankings : FALLBACK_RANKS).slice(0, 5)).map((r, i) => (
                        <div className="rankrow" key={i}><span className="rankpos">{r.pos}</span><span className="rq">{r.query}</span><span className="rt">{r.trend}</span></div>
                      ))}
                    </div>
                  </Section>
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
                        <Section id="ctr" label="Low CTR pages" variant="head" sub="High impressions but underperforming — quick wins">
                          {gscData.pages.map((p, i) => (
                            <div className="pagerow" key={i}>
                              <span className="pgpath">{p.page}</span>
                              <span className="pgmeta">{p.impressions} imp · {p.ctr} CTR · #{p.position}</span>
                            </div>
                          ))}
                        </Section>
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
              <span className="ct">Agents Feed</span>
              {pendingDrafts.length > 0 && <span className="draftbadge">{pendingDrafts.length}</span>}
            </div>
            <div className="col-body">
              {/* The agents publish through these accounts, so this is where linking them
                  belongs — not on a settings page you have to know exists. */}
              <AccountConnections />

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
                        {dr.approved && <button className="go2 go2-pri" onClick={() => markPublished(dr.id)}>Published</button>}
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
                // A saved entry only wins while it is current; after that the rotation does.
                const items = fresh && fe?.items?.length ? fe.items : contextualFeed[a.id]?.items || a.items;
                const draftN = pendingDrafts.filter((d) => d.channel === a.id).length;
                return (
                <div className={"agent" + (open[a.id] ? " open" : "")} key={a.id}>
                  <button className="agent-head" onClick={() => setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}>
                    <span className="aico" style={{ ["--ac" as string]: a.color } as React.CSSProperties}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{a.icon}</svg>
                    </span>
                    <span><div className="an">{a.name}</div><div className="as">{(fresh && fe?.summary) || contextualFeed[a.id]?.summary || a.sum}</div></span>
                    {draftN > 0 && <span className="abadge">{draftN}</span>}
                    <span className="chev">▾</span>
                  </button>
                  {open[a.id] && (
                    <div className="agent-body">
                      {items.map(([t, act], i) => (
                        <div className="aitem" key={i}><span>{t}</span>
                          <button className="go2 go2-pri" disabled={busyItem === a.id + ":" + i} onClick={() => workItem(a.id, i, t, a.name)}>
                            {busyItem === a.id + ":" + i ? <span className="btn-spin" aria-label="Working" /> : act}
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
            <div className="col-head"><span className="ct">Talk to AI CMO</span></div>
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
              {chat.map((m, i) => {
                const isContent = m.who === "ai" && ["content", "edit", "transform"].includes(m.intent || "");
                const label = m.who === "me" ? "you" : isContent ? "deliverable" : "AI CMO";
                return (
                  <div key={i} style={{ display: "contents" }}>
                    <span className={"msg-meta" + (m.who === "me" ? " me" : "")}>{label}</span>
                    <div className={"msg " + m.who + (isContent ? " deliverable" : "")}>
                      {m.text}
                      {m.who === "ai" && (
                        <div className="msg-actions">
                          <button onClick={() => { navigator.clipboard?.writeText(m.text).then(() => showToast("Copied")); }}>Copy</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {typing && (
                <div className="chat-processing">
                  <AIProcessing requestType={chatMode === "copy" ? "creative" : "strategy"} active={typing} />
                </div>
              )}
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
              {!doc.loading && (
                <button onClick={() => { navigator.clipboard?.writeText(doc.body).then(() => showToast("Copied")); }}><Icon name="doc" size={13} /> copy</button>
              )}
              <button aria-label="Close" onClick={() => setDoc(null)}><Icon name="close" size={15} /></button>
            </div>
            {doc.loading
              ? <div className="doc-body"><DocSkeleton /></div>
              : <div className="doc-body">{doc.body}</div>}
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
            <button className="xclose" aria-label="Close" onClick={() => setVerifyPopup(false)}><Icon name="close" size={15} /></button>
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
      {resuming && (
        <div className="resume" role="status" aria-live="polite">
          <span className="resume-dot" />
          <span>Brand understood — opening {resuming.includes("launch") ? "Launch Workspace" : resuming.includes("ugc") ? "UGC" : resuming.includes("social") ? "Publishing" : "Content"}…</span>
        </div>
      )}
      {authOpen && <AuthModal onClose={() => { if (!mustSignIn) setAuthOpen(false); }} forced={mustSignIn} />}
      {authUser && liveTrial && !liveTrial.active && (
        <div className="trial-lock">
          <div className="trial-lock-card">
            <span className="app-wordmark app-wordmark-lg">Populr.</span>
            <h2>Your free month has ended</h2>
            <p>Upgrade to keep your AI CMO running. Your workspace, drafts, and connections are safe.</p>
            <a
              className="acct-btn pri"
              style={{ marginTop: 18, display: "inline-block", textDecoration: "none" }}
              href="mailto:team@trypopulr.in?subject=Upgrade%20my%20Populr%20workspace&body=I%27d%20like%20to%20keep%20using%20Populr%20past%20the%20trial."
            >
              Upgrade — $15/mo
            </a>
            <p className="acct-dim" style={{ marginTop: 10, fontSize: 12 }}>
              Card payments aren&apos;t self-serve yet — we&apos;ll set you up by email, usually the same day.
            </p>
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
