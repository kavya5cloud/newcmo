"use client";
import { useCallback, useEffect, useState } from "react";
import { humanError, humanThrow } from "@/lib/ui/errors";

// Market Intelligence Dashboard — Opportunity Feed, Trend Explorer, Competitor Dashboard,
// Keyword Explorer, Business Graph Viewer and Research Center in one cockpit. Everything
// is live from /api/market/*; nothing is mocked.

type Opportunity = { id: string; kind: string; title: string; confidence: number; expectedImpact: string; urgency: string; reasoning: string; recommendedAction: string; suggestedCampaign: string; evidence: string[]; score: number };
type Trend = { id: string; topic: string; kind: string; strength: number; velocity: number; confidence: number; sources: string[]; signalCount: number };
type Competitor = { name: string; postingFrequencyPerWeek: number; engagementTrend: string; avgEngagement: number; contentCategories: { category: string; share: number }[]; summary: string; postCount: number };
type Keyword = { keyword: string; volume: number; difficulty: number; opportunity: number; cluster: string; contentSuggestions: string[] };
type GraphEntity = { id: string; type: string; label: string; weight: number };
type Brief = { headline: string; trends: Trend[]; opportunities: Opportunity[]; competitors: Competitor[]; keywords: Keyword[]; risks: string[]; narrative: string | null; generatedAt: number };

const TABS = ["Opportunities", "Trends", "Competitors", "Keywords", "Graph", "Research"] as const;
type Tab = (typeof TABS)[number];

const TIER: Record<string, string> = { high: "job-bad", medium: "job-warn", low: "job-muted" };
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function MarketDashboard() {
  const [tab, setTab] = useState<Tab>("Opportunities");
  const [terms, setTerms] = useState("ai cmo, marketing automation");
  const [competitors, setCompetitors] = useState("Okara, Jasper");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [graph, setGraph] = useState<{ entities: GraphEntity[]; edges: unknown[]; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/market/research", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terms: terms.split(",").map((s) => s.trim()).filter(Boolean),
          competitors: competitors.split(",").map((s) => s.trim()).filter(Boolean),
          industry: "saas", audience: "founders",
        }),
      });
      const d = await r.json();
      if (d.brief) setBrief(d.brief); else setErr(humanError(d, r.status));

      const q = new URLSearchParams({ terms, competitors, industry: "saas" });
      const g = await fetch(`/api/market/graph?${q}`).then((x) => x.json()).catch(() => null);
      if (g?.graph) setGraph(g.graph);
    } catch (e) { setErr(humanThrow(e)); }
    setBusy(false);
  }, [terms, competitors]);

  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="st-section lw">
      <header className="st-shead">
        <span className="label">Intelligence · Market</span>
        <h1>Market Intelligence</h1>
        <p>Populr watches the market and surfaces opportunities before competitors act. Every card carries the evidence it came from.</p>

        <div className="lw-chips" style={{ marginTop: 14 }}>
          <input className="mkt-input" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="terms, comma separated" />
          <input className="mkt-input" value={competitors} onChange={(e) => setCompetitors(e.target.value)} placeholder="competitors" />
          <button className="st-card-cta st-card-gen" onClick={run} disabled={busy}>{busy ? "Researching…" : "Run research"}</button>
        </div>

        <nav className="lw-subnav" style={{ marginTop: 14 }}>
          {TABS.map((t) => (
            <a key={t} href="#" onClick={(e) => { e.preventDefault(); setTab(t); }} className={tab === t ? "mkt-tab-on" : ""}>{t}</a>
          ))}
        </nav>
      </header>

      {err && <div className="lw-card lw-sev-high" style={{ borderLeft: "3px solid var(--redd)" }}>{err}</div>}
      {!brief && !err && <div className="st-empty"><p>Scanning the market…</p></div>}

      {brief && (
        <>
          <div className="lw-card" style={{ marginBottom: 18 }}>
            <div className="lw-k">Headline</div>
            <div className="lw-card-h">{brief.headline}</div>
            {brief.narrative && <p className="lw-hyp">{brief.narrative}</p>}
          </div>

          {tab === "Opportunities" && (
            <section className="lw-block">
              <h2 className="lw-h2">Opportunity Feed</h2>
              <div className="lw-cards">
                {brief.opportunities.map((o) => (
                  <div key={o.id} className="lw-card">
                    <div className="lw-rec-top">
                      <span className="lw-rec-type">{o.kind.replace(/_/g, " ")}</span>
                      <span className={"job-state " + (TIER[o.urgency] ?? "")}>{o.urgency} urgency</span>
                    </div>
                    <div className="lw-card-h">{o.title}</div>
                    <p className="lw-hyp">{o.reasoning}</p>
                    <div className="lw-meta">→ {o.recommendedAction}</div>
                    <div className="lw-meta">campaign: {o.suggestedCampaign}</div>
                    <div className="lw-chips">
                      <span className="lw-chip">confidence <b className="pub-count">{pct(o.confidence)}</b></span>
                      <span className="lw-chip">impact {o.expectedImpact}</span>
                      <span className="lw-chip">score <b className="pub-count">{pct(o.score)}</b></span>
                    </div>
                    <div className="lw-meta mkt-evidence">evidence: {o.evidence.slice(0, 3).join(" · ")}</div>
                  </div>
                ))}
                {brief.opportunities.length === 0 && <div className="lw-muted">No opportunities detected for these terms.</div>}
              </div>
            </section>
          )}

          {tab === "Trends" && (
            <section className="lw-block">
              <h2 className="lw-h2">Trend Explorer</h2>
              <div className="job-list">
                {brief.trends.map((t) => (
                  <div key={t.id} className="job-row">
                    <span className="job-type">{t.topic}</span>
                    <span className="job-state job-warn">{t.kind}</span>
                    <span className="job-bar"><span className="job-bar-fill" style={{ width: pct(t.confidence) }} /></span>
                    <span className="job-meta">conf {pct(t.confidence)} · vel {pct(t.velocity)} · {t.sources.length} src · {t.signalCount} signals</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "Competitors" && (
            <section className="lw-block">
              <h2 className="lw-h2">Competitor Dashboard</h2>
              <div className="lw-cards">
                {brief.competitors.map((c) => (
                  <div key={c.name} className="lw-card">
                    <div className="lw-card-h">{c.name}</div>
                    <p className="lw-hyp">{c.summary}</p>
                    <div className="lw-meta">{c.postingFrequencyPerWeek}/week · engagement {c.engagementTrend} · {c.postCount} posts</div>
                    <div className="lw-chips">
                      {c.contentCategories.slice(0, 4).map((k) => <span key={k.category} className="lw-chip">{k.category} {pct(k.share)}</span>)}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "Keywords" && (
            <section className="lw-block">
              <h2 className="lw-h2">Keyword Explorer</h2>
              <div className="job-list">
                {brief.keywords.map((k) => (
                  <div key={k.keyword} className="job-row">
                    <span className="job-type">{k.keyword}</span>
                    <span className="job-state job-ok">{k.cluster}</span>
                    <span className="job-bar"><span className="job-bar-fill" style={{ width: pct(k.opportunity) }} /></span>
                    <span className="job-meta">opp {pct(k.opportunity)} · vol {pct(k.volume)} · diff {pct(k.difficulty)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {tab === "Graph" && (
            <section className="lw-block">
              <h2 className="lw-h2">Business Graph <span className="lw-muted">{graph ? `v${graph.version}` : ""}</span></h2>
              {graph ? (
                <div className="lw-dep">
                  {["brand", "product", "audience", "competitor", "keyword", "trend", "integration"].map((type) => {
                    const items = graph.entities.filter((e) => e.type === type);
                    if (!items.length) return null;
                    return (
                      <div key={type} className="lw-dep-col">
                        <div className="lw-dep-h">{type}</div>
                        {items.slice(0, 8).map((e) => <div key={e.id} className="lw-dep-node">{e.label}</div>)}
                      </div>
                    );
                  })}
                </div>
              ) : <div className="lw-muted">Graph unavailable.</div>}
            </section>
          )}

          {tab === "Research" && (
            <section className="lw-block">
              <h2 className="lw-h2">Research Center</h2>
              <div className="lw-grid2">
                <div className="lw-card">
                  <div className="lw-k">This week</div>
                  <p className="lw-hyp">{brief.narrative ?? "Run research with a narrative to generate the written brief."}</p>
                  <div className="lw-meta">{new Date(brief.generatedAt).toLocaleString()}</div>
                </div>
                <div className="lw-card">
                  <div className="lw-k">Emerging risks</div>
                  {brief.risks.length ? (
                    <ul className="lw-list">{brief.risks.map((r) => <li key={r}>{r}</li>)}</ul>
                  ) : <div className="lw-muted">None detected.</div>}
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
