import { LearningEngine } from "@/lib/learning/engine";
import { normalizePerformanceEvent } from "@/lib/learning/performance";
import { recordDecisionFeedback, decisionAccuracy } from "@/lib/learning/decision-feedback";
import { generateInsights } from "@/lib/learning/insights";
import type { PerformanceEvent } from "@/lib/learning/types";

// Learning Dashboard (Part 8) — the intelligence cockpit. It ingests a deterministic set
// of performance events through the real Learning Engine and renders what was learned:
// Top Patterns, Learning Feed, Brand Evolution, Creative/Campaign Insights, Decision
// Accuracy, Winning Hooks, Winning Assets, Recommendations. Nothing is mocked.

const EVENTS: PerformanceEvent[] = [
  normalizePerformanceEvent({ assetKey: "c1:hero_video", kind: "hero_video", platform: "youtube", campaignId: "Demo & awareness", audience: "founders", at: Date.UTC(2026, 6, 1, 10), metrics: { conversions: 180, revenue: 4200, watch_time: 95, shares: 60 } }),
  normalizePerformanceEvent({ assetKey: "c1:linkedin_post", kind: "linkedin_post", platform: "linkedin", campaignId: "Demo & awareness", audience: "founders", at: Date.UTC(2026, 6, 2, 9), metrics: { conversions: 90, shares: 55, comments: 30 } }),
  normalizePerformanceEvent({ assetKey: "c2:ugc_video", kind: "ugc_video", platform: "tiktok", campaignId: "Community", audience: "makers", at: Date.UTC(2026, 6, 3, 18), metrics: { conversions: 70, likes: 900, bookmarks: 120 } }),
  normalizePerformanceEvent({ assetKey: "c3:email", kind: "email", platform: "email", campaignId: "Early access", at: Date.UTC(2026, 6, 4, 8), metrics: { conversions: 40, email_opens: 800, replies: 25 } }),
  normalizePerformanceEvent({ assetKey: "c2:carousel", kind: "carousel", platform: "instagram", campaignId: "Community", audience: "makers", at: Date.UTC(2026, 6, 5, 12), metrics: { likes: 300, bookmarks: 40 } }),
];

const FEEDBACK = [
  recordDecisionFeedback({ decisionId: "d1", channel: "seo", predictedImpact: 0.8, predictedConfidence: 0.6, actualPerformance: 0.55, at: 1 }),
  recordDecisionFeedback({ decisionId: "d2", channel: "x", predictedImpact: 0.7, predictedConfidence: 0.5, actualPerformance: 0.35, at: 2 }),
  recordDecisionFeedback({ decisionId: "d3", channel: "linkedin", predictedImpact: 0.75, predictedConfidence: 0.7, actualPerformance: 0.72, at: 3 }),
  recordDecisionFeedback({ decisionId: "d4", channel: "youtube", predictedImpact: 0.82, predictedConfidence: 0.7, actualPerformance: 0.8, at: 4 }),
];

const NAV = ["Patterns", "Feed", "Brand", "Insights", "Accuracy", "Hooks", "Assets", "Recommendations"];

export default async function LearningDashboard() {
  const engine = new LearningEngine();
  const result = await engine.ingest(EVENTS, { workspaceKey: "demo" });
  const acc = decisionAccuracy(FEEDBACK);
  const insights = generateInsights({ aggregates: result.aggregates, patterns: result.patterns, brand: await engine.brand.latest("demo"), accuracy: acc });
  const brand = await engine.brand.latest("demo");
  const topPatterns = [...result.patterns].sort((a, b) => b.performance - a.performance).slice(0, 8);
  const hooks = result.patterns.filter((p) => p.kind === "winning_hook");
  const winners = result.aggregates.filter((a) => a.score >= 0.35);

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <section className="st-section lw">
      <header className="st-shead">
        <span className="label">Marketing · Learning</span>
        <h1>What&apos;s working</h1>
        <p>
          {result.processedEvents} performance events → {result.patterns.length} patterns,
          brand DNA v{result.brandVersion}, {result.memoryUpdates} creative-memory updates.
          Deterministic — no LLM in the learning loop.
        </p>
        <nav className="lw-subnav">{NAV.map((s) => <a key={s} href={`#${s.toLowerCase()}`}>{s}</a>)}</nav>
      </header>

      {/* Top Patterns */}
      <section id="patterns" className="lw-block">
        <h2 className="lw-h2">Top Patterns</h2>
        <div className="lw-cards">
          {topPatterns.map((p) => (
            <div key={p.id} className="lw-card">
              <div className="lw-card-h">{p.kind.replace(/winning_/, "").replace(/_/g, " ")}</div>
              <div className="lw-meta">{p.label}</div>
              <div className="lw-meta"><span className="pub-count">{pct(p.performance)}</span> perf · {pct(p.confidence)} conf{p.platform ? ` · ${p.platform}` : ""}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Learning Feed */}
      <section id="feed" className="lw-block">
        <h2 className="lw-h2">Learning Feed</h2>
        <div className="lw-cards">
          {insights.map((it, i) => (
            <div key={i} className="lw-card">
              <div className="lw-k">{it.kind.replace(/_/g, " ")}</div>
              <div className="lw-card-h">{it.title}</div>
              <p className="lw-hyp">{it.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Brand Evolution */}
      <section id="brand" className="lw-block">
        <h2 className="lw-h2">Brand Evolution <span className="lw-muted">v{brand?.version ?? 0}</span></h2>
        <div className="lw-cards">
          {brand && Object.entries(brand.traits).filter(([, v]) => v.confidence > 0).map(([trait, v]) => (
            <div key={trait} className="lw-card">
              <div className="lw-k">{trait.replace(/_/g, " ")}</div>
              <div className="lw-card-h">{v.value || "—"}</div>
              <div className="lw-meta">confidence <span className="pub-count">{pct(v.confidence)}</span> · {v.evidence} obs</div>
            </div>
          ))}
        </div>
      </section>

      {/* Creative + Campaign Insights */}
      <section id="insights" className="lw-block">
        <h2 className="lw-h2">Creative &amp; Campaign Insights</h2>
        <div className="lw-chips">
          {result.signals.slice(0, 12).map((s) => (
            <span key={s.id} className="lw-chip">{s.kind.replace(/_/g, " ")}: {s.key} <span className="pub-count">{pct(s.performance)}</span></span>
          ))}
        </div>
      </section>

      {/* Decision Accuracy */}
      <section id="accuracy" className="lw-block">
        <h2 className="lw-h2">Decision Accuracy</h2>
        <div className="lw-grid2">
          <div className="lw-card lw-perf">
            <div className="lw-perf-metric">planner accuracy</div>
            <div className="lw-perf-target">{pct(acc.meanQuality)}</div>
            <div className="lw-muted">{acc.samples} decisions · trend {acc.trend}</div>
          </div>
          <div className="lw-card">
            <div className="lw-k">Prediction vs actual</div>
            <ul className="lw-list">
              {FEEDBACK.map((f) => <li key={f.id}>{f.channel}: predicted <b>{pct(f.predictedImpact)}</b> → actual <b>{pct(f.actualPerformance)}</b> <span className="lw-muted">(dev {f.deviation})</span></li>)}
            </ul>
          </div>
        </div>
      </section>

      {/* Winning Hooks */}
      <section id="hooks" className="lw-block">
        <h2 className="lw-h2">Winning Hooks</h2>
        <div className="lw-chips">
          {hooks.length ? hooks.map((h) => <span key={h.id} className="lw-chip">{h.label} <span className="pub-count">{pct(h.performance)}</span></span>) : <span className="lw-muted">No winning hooks yet.</span>}
        </div>
      </section>

      {/* Winning Assets */}
      <section id="assets" className="lw-block">
        <h2 className="lw-h2">Winning Assets</h2>
        <div className="lw-cards">
          {winners.map((a) => (
            <div key={a.assetKey} className="lw-card">
              <div className="lw-card-h">{a.kind?.replace(/_/g, " ") ?? a.assetKey}</div>
              <div className="lw-meta">{a.platform} · <span className="pub-count">{pct(a.score)}</span>{a.bestHour !== null ? ` · best ${a.bestHour}:00` : ""}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Recommendations */}
      <section id="recommendations" className="lw-block">
        <h2 className="lw-h2">Recommendations</h2>
        <div className="lw-cards">
          {insights.filter((i) => i.kind === "recommendation" || i.kind === "channel_signal").map((it, i) => (
            <div key={i} className="lw-card lw-sev-low" style={{ borderLeft: "3px solid var(--acc)" }}>
              <div className="lw-card-h">{it.title}</div>
              <p className="lw-hyp">{it.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
