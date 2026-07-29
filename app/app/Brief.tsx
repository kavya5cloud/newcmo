"use client";
import { useCallback, useEffect, useState } from "react";
import type { DailyBrief } from "@/lib/brief/types";

// The Daily Brief.
//
// One paragraph, one recommendation, and the supporting facts as a single line of
// counters. Deliberately not a grid of cards: the point is to be read in ten seconds and
// leave the reader with one thing to do, and a wall of tiles is how that gets lost.
//
// Everything is a link into the screen that owns it. Nothing here is a second source of
// truth — every number came from the engine you land on when you click it.

const when = (t: number) => new Date(t).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function Brief({ company }: { company?: string }) {
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setBusy(refresh);
    try {
      const q = new URLSearchParams();
      if (company) q.set("company", company);
      if (refresh) q.set("refresh", "1");
      const d = await fetch(`/api/brief?${q}`).then((r) => r.json());
      if (d?.ok) { setBrief(d.brief); setErr(false); } else setErr(true);
    } catch { setErr(true); }
    finally { setBusy(false); }
  }, [company]);

  useEffect(() => { load(); }, [load]);

  // A brief that fails to load must not become a broken block at the top of the app.
  if (err) return null;

  if (!brief) {
    return (
      <section className="brief" aria-busy="true">
        <div className="brief-skel brief-skel-h" />
        <div className="brief-skel" />
        <div className="brief-skel brief-skel-s" />
      </section>
    );
  }

  const p = brief.publishing;
  const counts: [string, string, string][] = [
    [String(p.today), p.today === 1 ? "publishing today" : "publishing today", "/studio/social"],
    [String(brief.approvals.count), brief.approvals.count === 1 ? "awaiting approval" : "awaiting approval", "/studio/launch#execution"],
    [String(brief.campaigns.running), brief.campaigns.running === 1 ? "campaign running" : "campaigns running", "/studio/launch#campaigns"],
  ];
  if (p.failed > 0) counts.push([String(p.failed), p.failed === 1 ? "publish failed" : "publishes failed", "/studio/social"]);

  return (
    <section className="brief" aria-label="Today's brief">
      <p className="brief-hello">{brief.greeting}, {brief.company}</p>
      <p className="brief-summary">{brief.summary}</p>

      {/* The one thing worth doing, with the reason it is that thing. */}
      <div className="brief-rec">
        <div className="brief-rec-body">
          <span className="brief-rec-title">{brief.recommendation.title}</span>
          <span className="brief-rec-why">{brief.recommendation.why}</span>
        </div>
        {brief.recommendation.href && (
          <a className="brief-rec-go" href={brief.recommendation.href}>Do it</a>
        )}
      </div>

      <div className="brief-counts">
        {counts.map(([n, label, href]) => (
          <a key={label} className="brief-count" href={href}>
            <b>{n}</b> {label}
          </a>
        ))}
        {p.nextAt && <span className="brief-count brief-count-flat">next {p.nextPlatform} {when(p.nextAt)}</span>}
      </div>

      <div className="brief-more">
        <button className="brief-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Less" : "More"}
        </button>
        <button className="brief-toggle" disabled={busy} onClick={() => load(true)}>
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {open && (
        <div className="brief-detail">
          {brief.market.opportunities.length + brief.market.trends.length + brief.market.competitors.length > 0 && (
            <div className="brief-block">
              <span className="brief-k">Market</span>
              <ul>
                {brief.market.competitors.map((c) => <li key={c}>{c}</li>)}
                {brief.market.opportunities.map((o) => <li key={o}>{o}</li>)}
                {brief.market.trends.length > 0 && <li>Trending: {brief.market.trends.join(", ")}</li>}
              </ul>
            </div>
          )}

          {(brief.performance.improvements.length > 0 || brief.performance.detail.length > 0) && (
            <div className="brief-block">
              <span className="brief-k">Performance</span>
              <ul>
                {brief.performance.improvements.map((i) => <li key={i}>{i}</li>)}
                {brief.performance.detail.map((d) => <li key={d.label} className="brief-metric">{d.label}: {d.value}</li>)}
              </ul>
            </div>
          )}

          {brief.campaigns.lines.length > 0 && (
            <div className="brief-block">
              <span className="brief-k">Campaigns</span>
              <ul>
                {brief.campaigns.lines.map((l) => (
                  <li key={l.id}>{l.title} — {l.percent}%{l.blocked && l.reason ? ` · ${l.reason}` : ` · ${l.health.replace(/_/g, " ")}`}</li>
                ))}
              </ul>
            </div>
          )}

          {(brief.upcoming.today.length + brief.upcoming.tomorrow.length + brief.upcoming.thisWeek.length) > 0 && (
            <div className="brief-block">
              <span className="brief-k">Upcoming</span>
              <ul>
                {brief.upcoming.today.slice(0, 4).map((u, i) => <li key={`t${i}`}>Today {time(u.at)} — {u.label}</li>)}
                {brief.upcoming.tomorrow.slice(0, 3).map((u, i) => <li key={`m${i}`}>Tomorrow {time(u.at)} — {u.label}</li>)}
                {brief.upcoming.thisWeek.slice(0, 3).map((u, i) => <li key={`w${i}`}>{when(u.at)} — {u.label}</li>)}
              </ul>
            </div>
          )}

          {brief.activity.length > 0 && (
            <div className="brief-block">
              <span className="brief-k">Recent AI activity</span>
              <ul>
                {brief.activity.slice(0, 6).map((a, i) => (
                  <li key={i}><span className="brief-at">{time(a.at)}</span> {a.message}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="brief-src">
            {brief.summarySource === "llm" ? "Summary written by AI." : "Summary assembled from your data."}
            {" "}Updated {time(brief.generatedAt)}.
          </p>
        </div>
      )}
    </section>
  );
}
