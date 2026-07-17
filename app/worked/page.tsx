"use client";
import { useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";

// "What Actually Worked" — recommendations ranked by measured outcome (association
// scores from before/after Search Console snapshots), plus the per-channel funnel.

type WorkedRow = {
  id: string;
  channel: string;
  title: string;
  host: string;
  delta: {
    impressions?: { pct: number };
    clicks?: { pct: number };
    ctr?: { pct: number };
    position?: { change: number };
  } | null;
  score: number;
  confidence: number;
};
type ChannelRow = {
  channel: string;
  generated: number;
  drafted: number;
  approved: number;
  published: number;
  approvalRate: number;
  avgScore: number | null;
};

const SORTS = [
  ["score", "Association score"],
  ["traffic", "Traffic increase"],
  ["ctr", "CTR increase"],
  ["ranking", "Ranking gain"],
] as const;

function fmtPct(p?: number) {
  if (p == null) return "—";
  const v = (p * 100).toFixed(0);
  return (p >= 0 ? "+" : "") + v + "%";
}

export default function Worked() {
  const [rows, setRows] = useState<WorkedRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("score");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/intel/worked?wsid=${encodeURIComponent(workspaceId())}&sort=${sort}`)
      .then((r) => r.json())
      .then((d) => {
        setRows(Array.isArray(d.worked) ? d.worked : []);
        setChannels(Array.isArray(d.channels) ? d.channels : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sort]);

  return (
    <div className="worked">
      <div className="w-top">
        <a href="/app">← Back to dashboard</a>
        <span className="w-wordmark">Populr.</span>
      </div>

      <h1>What actually worked</h1>
      <p className="w-sub">
        Every recommendation is tracked from generation to approval to measured outcome. Scores below compare your
        Search Console metrics before and after each approved action — association, not proof of causation.
      </p>

      <h2>Ranked outcomes</h2>
      <div className="w-sort">
        {SORTS.map(([k, label]) => (
          <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{label}</button>
        ))}
      </div>

      {loading ? (
        <div className="w-empty">Loading…</div>
      ) : rows.length ? (
        <div className="w-scroll">
          <table>
            <thead>
              <tr>
                <th>Recommendation</th><th>Channel</th><th>Clicks</th><th>Impressions</th>
                <th>CTR</th><th>Position</th><th>Score</th><th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td className="w-chan">{r.channel}</td>
                  <td className={(r.delta?.clicks?.pct ?? 0) >= 0 ? "w-pos" : "w-neg"}>{fmtPct(r.delta?.clicks?.pct)}</td>
                  <td className={(r.delta?.impressions?.pct ?? 0) >= 0 ? "w-pos" : "w-neg"}>{fmtPct(r.delta?.impressions?.pct)}</td>
                  <td className={(r.delta?.ctr?.pct ?? 0) >= 0 ? "w-pos" : "w-neg"}>{fmtPct(r.delta?.ctr?.pct)}</td>
                  <td className={(r.delta?.position?.change ?? 0) <= 0 ? "w-pos" : "w-neg"}>
                    {r.delta?.position ? (r.delta.position.change <= 0 ? "↑" : "↓") + Math.abs(r.delta.position.change).toFixed(1) : "—"}
                  </td>
                  <td className="w-score">{(r.score * 100).toFixed(0)}</td>
                  <td className="w-chan">{(r.confidence * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="w-empty">
          No measured outcomes yet. Outcomes appear after: (1) you approve recommendations, (2) your site is connected
          to Google Search Console, and (3) the weekly snapshot has captured a before + after window (~1–2 weeks).
          Every approval you make today is already being logged toward this.
        </div>
      )}

      <h2>Channel funnel</h2>
      {channels.length ? (
        <div className="w-scroll">
          <table>
            <thead>
              <tr><th>Channel</th><th>Generated</th><th>Drafted</th><th>Approved</th><th>Published</th><th>Approval rate</th><th>Avg score</th></tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channel}>
                  <td className="w-chan">{c.channel}</td>
                  <td>{c.generated}</td>
                  <td>{c.drafted}</td>
                  <td>{c.approved}</td>
                  <td>{c.published}</td>
                  <td>{(c.approvalRate * 100).toFixed(0)}%</td>
                  <td className="w-score">{c.avgScore == null ? "—" : (c.avgScore * 100).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="w-empty">No recommendations logged yet — analyze a site from the dashboard to start the dataset.</div>
      )}

      <p className="w-note">
        score 50 = no movement · above 50 = metrics improved after the action · confidence reflects data volume.
        Populr never claims causality from a single observation; scores aggregate into channel-level intelligence over time.
      </p>
    </div>
  );
}
