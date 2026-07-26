"use client";
import { useCallback, useEffect, useState } from "react";
import { flagDependents } from "@/lib/launch/dependencies";
import { AUTOMATION_KEYS, AUTOMATION_META, type Automation, type ItemAction, type ItemStatus } from "@/lib/launch/workspace";
import { COMMAND_EXAMPLES } from "@/lib/launch/command";
import type { LaunchPlan, LaunchRecommendation } from "@/lib/launch/types";

// Launch Workspace — the same dashboard, now actionable. Layout, sections and classes are
// unchanged; every panel is wired to the service that already owns it:
//   workspace state → /api/launch/workspace   publishing → /api/social/*
//   market intel    → /api/market/research    performance → /api/learning/dashboard
//   generation      → /api/content/generate
// Nothing here re-implements planning, scheduling or publishing logic.

const STAGE_LABEL: Record<string, string> = { foundation: "Foundation", distribution: "Distribution", amplification: "Amplification", conversion: "Conversion" };
const SEV_CLASS: Record<string, string> = { high: "lw-sev-high", medium: "lw-sev-med", low: "lw-sev-low" };
const NAV = ["Mission", "Campaigns", "Timeline", "Assets", "Dependencies", "Publishing", "Market", "Experiments", "Performance", "Automation"];

const STATUS_LABEL: Record<ItemStatus, string> = { todo: "To do", in_progress: "In progress", done: "Done", paused: "Paused" };
const STATUS_CLASS: Record<ItemStatus, string> = { todo: "job-muted", in_progress: "job-warn", done: "job-ok", paused: "job-bad" };
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Snapshot values are heterogeneous; render primitives, and name objects rather than
 *  printing "[object Object]" at a founder. */
function scalar(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
  const o = v as Record<string, unknown>;
  const name = o.label ?? o.name ?? o.title ?? o.id;
  return typeof name === "string" ? name : "—";
}

type Progress = {
  campaignId: string; title: string; total: number; done: number; inProgress: number; paused: number;
  percent: number; status: string;
  nextPublish: { assetKey: string; label: string; channel: string; dayOffset: number } | null;
  awaitingApproval: number; queued: number;
};
type Summary = { totalItems: number; done: number; inProgress: number; paused: number; percent: number; campaignsComplete: number; automationOn: number };
type Mission = { mission: string; objectives: { id: string; statement: string; kpi?: string }[]; kpis: { metric: string; target: string; timeframe: string }[]; successMetrics: string[] };
type WsPayload = { degraded?: boolean; mission: Mission; items: Record<string, ItemStatus>; automation: Automation; progress: Progress[]; summary: Summary; recommendations: LaunchRecommendation[] };

type PubPayload = {
  accounts: { id: string; platform: string; handle: string; status: string }[];
  metrics: Record<string, number>;
  calendar: { id: string; platform: string; scheduledAt: number | null; localTime: string | null; text: string }[];
  jobs: { id: string; platform: string; state: string; attempts: number; text: string; error: string | null }[];
};
type Opportunity = { id: string; title: string; kind: string; confidence: number; recommendedAction: string; suggestedCampaign: string; urgency: string };
type MarketPayload = { headline: string; opportunities: Opportunity[]; trends: { id: string; topic: string; confidence: number }[]; keywords: { keyword: string; opportunity: number }[]; competitors: { name: string; summary: string }[] };
type PerfPayload = { snapshot: Record<string, unknown> | null; insights: { id?: string; title?: string; message?: string; detail?: string }[]; accuracy: number | null };

export default function LaunchWorkspaceClient({ plan }: { plan: LaunchPlan }) {
  const [ws, setWs] = useState<WsPayload | null>(null);
  const [pub, setPub] = useState<PubPayload | null>(null);
  const [market, setMarket] = useState<MarketPayload | null>(null);
  const [perf, setPerf] = useState<PerfPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);
  const [editingMission, setEditingMission] = useState(false);
  const [draft, setDraft] = useState<Mission | null>(null);
  const [cmd, setCmd] = useState("");
  const [cmdOut, setCmdOut] = useState<{ summary: string; done?: string; details?: string[] } | null>(null);

  const g = plan.dependencies;
  const maxDepth = g.nodes.reduce((m, n) => Math.max(m, n.depth), 0);
  const c0 = plan.campaigns[0];

  const loadWorkspace = useCallback(async () => {
    const r = await fetch(`/api/launch/workspace?launchId=${plan.launchId}`).then((x) => x.json()).catch(() => null);
    if (r?.ok) setWs(r);
  }, [plan.launchId]);

  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);

  useEffect(() => {
    fetch("/api/social/dashboard").then((r) => r.json()).then((d) => { if (d?.ok) setPub(d); }).catch(() => {});
    fetch("/api/learning/dashboard").then((r) => r.json()).then((d) => { if (d?.ok) setPerf(d); }).catch(() => {});
    fetch("/api/market/research", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terms: [plan.mission], competitors: [], industry: "saas", audience: plan.campaigns[0]?.brief?.audience ?? "founders" }),
    }).then((r) => r.json()).then((d) => { if (d?.brief) setMarket(d.brief); }).catch(() => {});
  }, [plan.mission, plan.campaigns]);

  const post = useCallback(async (url: string, body: Record<string, unknown>, tag: string) => {
    setBusy(tag); setNote(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || d.error) { setNote(String(d.error || `request failed (${r.status})`)); return null; }
      return d;
    } catch { setNote("network error — check your connection"); return null; }
    finally { setBusy(null); }
  }, []);

  const itemAction = useCallback(async (assetKey: string, action: ItemAction) => {
    const d = await post("/api/launch/workspace", { op: "item", assetKey, action, launchId: plan.launchId }, `item:${assetKey}`);
    if (d?.ok) setWs((w) => (w ? { ...w, items: d.items, progress: d.progress, summary: d.summary } : w));
  }, [post, plan.launchId]);

  const bulk = useCallback(async (assetKeys: string[], action: ItemAction, tag: string) => {
    const d = await post("/api/launch/workspace", { op: "bulkItems", assetKeys, action, launchId: plan.launchId }, tag);
    if (d?.ok) setWs((w) => (w ? { ...w, items: d.items, progress: d.progress, summary: d.summary } : w));
  }, [post, plan.launchId]);

  const toggle = useCallback(async (key: string, on: boolean) => {
    const d = await post("/api/launch/workspace", { op: "automation", key, on, launchId: plan.launchId }, `auto:${key}`);
    if (d?.ok) setWs((w) => (w ? { ...w, automation: d.automation, summary: d.summary } : w));
  }, [post, plan.launchId]);

  const saveMission = useCallback(async () => {
    if (!draft) return;
    const d = await post("/api/launch/workspace", { op: "mission", mission: draft, launchId: plan.launchId }, "mission");
    if (d?.ok) { setWs((w) => (w ? { ...w, mission: d.mission } : w)); setEditingMission(false); setNote("Mission saved."); }
  }, [draft, post, plan.launchId]);

  const runCommand = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const d = await post("/api/launch/command", { text, launchId: plan.launchId }, "cmd");
    if (!d) return;
    setCmdOut({ summary: d.parsed.summary, done: d.outcome?.done, details: d.outcome?.details });
    if (d.items) setWs((w) => (w ? { ...w, items: d.items, progress: d.progress, summary: d.summary } : w));
  }, [post, plan.launchId]);

  const generate = useCallback(async (kind: string, campaignId: string) => {
    const d = await post("/api/content/generate", { kind, campaignId, mission: plan.mission, dryRun: true }, `gen:${campaignId}:${kind}`);
    if (d?.ok || d?.result) setNote(`Generated a ${kind.replace(/_/g, " ")} preview for ${campaignId}. Open the Creative Studio to publish it.`);
  }, [post, plan.mission]);

  const addOpportunity = useCallback(async (o: Opportunity) => {
    const d = await post("/api/social/drafts", {
      title: o.title, platforms: ["linkedin"],
      content: { text: `${o.title}\n\n${o.recommendedAction}` },
    }, `opp:${o.id}`);
    if (d?.draft || d?.ok) setNote(`"${o.title}" added as a draft — it's in Publishing → drafts, ready to schedule.`);
  }, [post]);

  const retryJob = useCallback(async (jobId: string) => {
    const d = await post("/api/social/retry", { jobId }, `retry:${jobId}`);
    if (d) { setNote("Retry queued."); fetch("/api/social/dashboard").then((r) => r.json()).then((x) => { if (x?.ok) setPub(x); }).catch(() => {}); }
  }, [post]);

  const status = (key: string): ItemStatus => ws?.items[key] ?? "todo";
  const mission = ws?.mission ?? { mission: plan.mission, objectives: plan.objectives, kpis: plan.kpis, successMetrics: [] };
  const progressOf = (id: string) => ws?.progress.find((p) => p.campaignId === id) ?? null;
  // Only surface a recommendation on the campaign it actually cites — a generic one
  // repeated on every card reads as advice about that campaign when it isn't.
  const recFor = (id: string, title: string) =>
    ws?.recommendations.find((r) => r.evidence.some((e) => e.includes(id) || e.includes(title))) ?? null;

  const ItemActions = ({ assetKey }: { assetKey: string }) => {
    const s = status(assetKey);
    const disabled = busy === `item:${assetKey}`;
    return (
      <span className="lwa-actions">
        <span className={"job-state " + STATUS_CLASS[s]}>{STATUS_LABEL[s]}</span>
        {s !== "done" && <button className="lwa-btn" disabled={disabled} onClick={() => itemAction(assetKey, "complete")}>Complete</button>}
        {s === "paused"
          ? <button className="lwa-btn" disabled={disabled} onClick={() => itemAction(assetKey, "resume")}>Resume</button>
          : s !== "done" && <button className="lwa-btn" disabled={disabled} onClick={() => itemAction(assetKey, "pause")}>Pause</button>}
        {s !== "todo" && <button className="lwa-btn" disabled={disabled} onClick={() => itemAction(assetKey, "reset")}>Reset</button>}
      </span>
    );
  };

  return (
    <section className="st-section lw">
      <header className="st-shead">
        <span className="label">Launch Workspace</span>
        <h1>{mission.mission}</h1>
        <p>
          One mission, {plan.summary.campaignCount} campaigns, {plan.summary.assetCount} assets across {plan.summary.weekCount} weeks —
          planned, sequenced and dependency-aware. Generated by the Launch Engine.
        </p>

        {/* Command bar — deterministic parsing, executed through the existing services. */}
        <form className="lwa-cmd" onSubmit={(e) => { e.preventDefault(); runCommand(cmd); }}>
          <input
            className="mkt-input lwa-cmd-in" value={cmd} onChange={(e) => setCmd(e.target.value)}
            placeholder="Tell Populr what to do — e.g. “Schedule everything”" aria-label="Command"
          />
          <button className="st-card-cta st-card-gen" type="submit" disabled={busy === "cmd"}>{busy === "cmd" ? "Working…" : "Run"}</button>
        </form>
        <div className="lw-chips lwa-examples">
          {COMMAND_EXAMPLES.map((e) => (
            <button key={e} type="button" className="lw-chip lwa-chip-btn" onClick={() => { setCmd(e); runCommand(e); }}>{e}</button>
          ))}
        </div>
        {cmdOut && (
          <div className="lw-card lwa-cmdout">
            <div className="lw-k">{cmdOut.summary}</div>
            {cmdOut.done && <div className="lw-card-h">{cmdOut.done}</div>}
            {cmdOut.details?.length ? <ul className="lw-list">{cmdOut.details.map((d) => <li key={d}>{d}</li>)}</ul> : null}
          </div>
        )}
        {note && <div className="lw-card lwa-note">{note}</div>}
        {ws?.degraded && <div className="lw-card lwa-note">Execution state is temporarily unavailable — the plan below is live, but progress and actions won't save until storage recovers.</div>}

        {ws && (
          <div className="lwa-summary">
            <span className="job-bar lwa-bar"><span className="job-bar-fill" style={{ width: pct(ws.summary.percent) }} /></span>
            <span className="lw-meta">
              {ws.summary.done}/{ws.summary.totalItems} items done · {ws.summary.inProgress} in progress · {ws.summary.paused} paused ·
              {" "}{ws.summary.campaignsComplete}/{plan.summary.campaignCount} campaigns complete · {ws.summary.automationOn} automations on
            </span>
          </div>
        )}

        <nav className="lw-subnav">
          {NAV.map((s) => <a key={s} href={`#${s.toLowerCase()}`}>{s}</a>)}
        </nav>
      </header>

      {/* Mission */}
      <section id="mission" className="lw-block">
        <h2 className="lw-h2">
          Mission
          <button className="lwa-btn lwa-h2-btn" onClick={() => { setDraft({ ...mission }); setEditingMission((v) => !v); }}>
            {editingMission ? "Cancel" : "Edit"}
          </button>
        </h2>

        {editingMission && draft ? (
          <div className="lw-card lwa-edit">
            <label className="lw-k" htmlFor="m-mission">Mission</label>
            <input id="m-mission" className="mkt-input" value={draft.mission} onChange={(e) => setDraft({ ...draft, mission: e.target.value })} />

            <div className="lw-k" style={{ marginTop: 14 }}>Objectives</div>
            {draft.objectives.map((o, i) => (
              <div key={o.id} className="lwa-row">
                <input className="mkt-input" value={o.statement}
                  onChange={(e) => { const next = [...draft.objectives]; next[i] = { ...o, statement: e.target.value }; setDraft({ ...draft, objectives: next }); }} />
                <input className="mkt-input lwa-narrow" value={o.kpi ?? ""} placeholder="KPI"
                  onChange={(e) => { const next = [...draft.objectives]; next[i] = { ...o, kpi: e.target.value }; setDraft({ ...draft, objectives: next }); }} />
              </div>
            ))}

            <div className="lw-k" style={{ marginTop: 14 }}>KPIs</div>
            {draft.kpis.map((k, i) => (
              <div key={i} className="lwa-row">
                <input className="mkt-input" value={k.metric}
                  onChange={(e) => { const next = [...draft.kpis]; next[i] = { ...k, metric: e.target.value }; setDraft({ ...draft, kpis: next }); }} />
                <input className="mkt-input lwa-narrow" value={k.target}
                  onChange={(e) => { const next = [...draft.kpis]; next[i] = { ...k, target: e.target.value }; setDraft({ ...draft, kpis: next }); }} />
                <input className="mkt-input lwa-narrow" value={k.timeframe}
                  onChange={(e) => { const next = [...draft.kpis]; next[i] = { ...k, timeframe: e.target.value }; setDraft({ ...draft, kpis: next }); }} />
              </div>
            ))}

            <div className="lw-k" style={{ marginTop: 14 }}>Success metrics</div>
            <textarea className="mkt-input lwa-area" rows={3} value={draft.successMetrics.join("\n")}
              placeholder="One per line"
              onChange={(e) => setDraft({ ...draft, successMetrics: e.target.value.split("\n").filter(Boolean) })} />

            <div className="lwa-actions" style={{ marginTop: 14 }}>
              <button className="st-card-cta st-card-gen" onClick={saveMission} disabled={busy === "mission"}>{busy === "mission" ? "Saving…" : "Save mission"}</button>
              <button className="lwa-btn" onClick={() => setEditingMission(false)}>Discard</button>
            </div>
          </div>
        ) : (
          <div className="lw-grid2">
            <div className="lw-card">
              <div className="lw-k">Objectives</div>
              <ul className="lw-list">{mission.objectives.map((o) => <li key={o.id}>{o.statement}{o.kpi ? <span className="lw-tag">{o.kpi}</span> : null}</li>)}</ul>
              {mission.successMetrics.length > 0 && <>
                <div className="lw-k" style={{ marginTop: 14 }}>Success metrics</div>
                <ul className="lw-list">{mission.successMetrics.map((m) => <li key={m}>{m}</li>)}</ul>
              </>}
            </div>
            <div className="lw-card">
              <div className="lw-k">KPIs</div>
              <ul className="lw-list">{mission.kpis.map((k, i) => <li key={i}>{k.metric}: <b>{k.target}</b> <span className="lw-muted">/ {k.timeframe}</span></li>)}</ul>
              {plan.risks.length > 0 && <>
                <div className="lw-k" style={{ marginTop: 14 }}>Risks</div>
                <ul className="lw-list">{plan.risks.map((r) => <li key={r.id}><span className={"lw-dot " + SEV_CLASS[r.level]} />{r.description}</li>)}</ul>
              </>}
            </div>
          </div>
        )}
      </section>

      {/* Campaigns */}
      <section id="campaigns" className="lw-block">
        <h2 className="lw-h2">Campaigns</h2>
        <div className="lw-cards">
          {plan.campaigns.map((c) => {
            const p = progressOf(c.id);
            const rec = recFor(c.id, c.title);
            const keys = plan.weeks.flatMap((w) => w.items.filter((i) => i.campaignId === c.id).map((i) => i.assetKey));
            const open = openCampaign === c.id;
            return (
              <div key={c.id} className={"lw-card" + (open ? " lwa-open" : "")}>
                <div className="lw-rec-top lwa-cardtop">
                  <span className="lw-card-h">{c.title}</span>
                  {p && <span className={"job-state " + (p.status === "complete" ? "job-ok" : p.status === "paused" ? "job-bad" : p.status === "in_progress" ? "job-warn" : "job-muted")}>
                    {p.status.replace(/_/g, " ")}
                  </span>}
                </div>
                <div className="lw-meta">{STAGE_LABEL[c.phase]} · goal {c.goal.replace(/_/g, " ")} · P{c.priority}</div>
                <div className="lw-chips">{c.channels.map((ch) => <span key={ch} className="lw-chip">{ch}</span>)}</div>

                {p && <>
                  <span className="job-bar lwa-bar"><span className="job-bar-fill" style={{ width: pct(p.percent) }} /></span>
                  <div className="lw-meta">{p.done}/{p.total} done · {p.inProgress} in progress · {p.awaitingApproval} awaiting approval · {p.queued} queued</div>
                  <div className="lw-meta">
                    {p.nextPublish ? <>Next publish: {p.nextPublish.label} on {p.nextPublish.channel}, day {p.nextPublish.dayOffset}</> : "Nothing left to publish."}
                  </div>
                </>}
                <div className="lw-meta">{c.assetPlan.summary.total} assets · {Math.round(c.budgetShare * 100)}% of budget</div>
                {rec && <div className="lw-meta lwa-rec">Recommendation: {rec.message} → {rec.suggestedAction}</div>}

                <div className="lwa-actions">
                  <button className="lwa-btn" onClick={() => setOpenCampaign(open ? null : c.id)}>{open ? "Close" : "Open campaign"}</button>
                  <button className="lwa-btn" disabled={busy === `bulk:${c.id}`} onClick={() => bulk(keys, "start", `bulk:${c.id}`)}>Start all</button>
                  <button className="lwa-btn" disabled={busy === `bulkp:${c.id}`} onClick={() => bulk(keys, "pause", `bulkp:${c.id}`)}>Pause all</button>
                </div>

                {open && (
                  <div className="lwa-detail">
                    {plan.weeks.flatMap((w) => w.items.filter((i) => i.campaignId === c.id)).map((it) => (
                      <div key={it.assetKey} className="lwa-detail-row">
                        <span className="job-type">{it.quantity > 1 ? `${it.quantity}× ` : ""}{it.label}</span>
                        <span className="lw-muted">{it.channel}</span>
                        <span className="lwa-actions">
                          <ItemActions assetKey={it.assetKey} />
                          <button className="lwa-btn" disabled={busy === `gen:${c.id}:${it.kind}`} onClick={() => generate(it.kind, c.id)}>Generate</button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Timeline */}
      <section id="timeline" className="lw-block">
        <h2 className="lw-h2">Timeline</h2>
        <div className="lw-timeline">
          {plan.weeks.map((w) => (
            <div key={w.week} className="lw-week">
              <div className="lw-week-h">{w.label}<span className="lw-week-phase">{STAGE_LABEL[w.phase]}</span></div>
              <ul className="lw-week-items">
                {w.items.length === 0 ? <li className="lw-muted">—</li> :
                  w.items.map((it) => {
                    const downstream = flagDependents(g, it.assetKey).length;
                    return (
                      <li key={it.assetKey} className={status(it.assetKey) === "done" ? "lwa-item-done" : undefined}>
                        {it.quantity > 1 ? `${it.quantity}× ` : ""}{it.label}<span className="lw-week-ch">{it.channel}</span>
                        <ItemActions assetKey={it.assetKey} />
                        {downstream > 0 && <span className="lw-muted lwa-dep" title="downstream assets flagged when this changes">{downstream} downstream</span>}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Assets */}
      <section id="assets" className="lw-block">
        <h2 className="lw-h2">Assets</h2>
        <div className="lw-cards">
          {plan.campaigns.map((c) => (
            <div key={c.id} className="lw-card">
              <div className="lw-card-h">{c.title}</div>
              <div className="lwa-assets">
                {c.assetPlan.assets.map((a) => (
                  <button key={a.key} className="lw-chip lwa-chip-btn" disabled={busy === `gen:${c.id}:${a.kind}`}
                    onClick={() => generate(a.kind, c.id)} title="Generate this asset">
                    {a.quantity > 1 ? `${a.quantity}× ` : ""}{a.label} +
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Dependencies */}
      <section id="dependencies" className="lw-block">
        <h2 className="lw-h2">Dependencies</h2>
        <p className="lw-muted lw-sub">Change an upstream asset and every downstream asset is flagged for review.</p>
        <div className="lw-dep">
          {Array.from({ length: maxDepth + 1 }, (_, d) => (
            <div key={d} className="lw-dep-col">
              <div className="lw-dep-h">Depth {d}</div>
              {g.nodes.filter((n) => n.depth === d).map((n) => {
                const flagged = flagDependents(g, n.key).length;
                return (
                  <div key={n.key} className="lw-dep-node" title={n.dependsOn.length ? `from ${n.dependsOn.join(", ")}` : "root"}>
                    {n.label}
                    {flagged > 0 && <span className="lw-dep-count">{flagged}↓</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* Publishing — live from the Cross-Platform Publishing System */}
      <section id="publishing" className="lw-block">
        <h2 className="lw-h2">Publishing</h2>
        <div className="lw-pipe">
          {["draft", "creative_review", "approval", "scheduled", "publishing", "published", "measured", "archived"].map((s, i) => (
            <span key={s} className="lw-pipe-stage">{s.replace(/_/g, " ")}{i < 7 ? <span className="lw-pipe-arrow">→</span> : null}</span>
          ))}
        </div>

        <div className="lw-grid2">
          <div className="lw-card">
            <div className="lw-k">Connected platforms</div>
            {pub?.accounts.length
              ? <div className="lw-chips">{pub.accounts.map((a) => <span key={a.id} className="lw-chip">{a.platform} · {a.handle} <b className="pub-count">{a.status}</b></span>)}</div>
              : <div className="lw-muted">No platforms connected yet — connect them in Cross-Post, then scheduling runs from here.</div>}
            {pub && <div className="lw-meta">{Object.entries(pub.metrics).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")}</div>}
          </div>
          <div className="lw-card">
            <div className="lw-k">Scheduled</div>
            {pub?.calendar.length
              ? <ul className="lw-list">{pub.calendar.slice(0, 6).map((s) => <li key={s.id}>{s.localTime ?? "—"} · {s.platform} · {s.text}</li>)}</ul>
              : <div className="lw-muted">Nothing scheduled. Run “Schedule everything” above to queue the plan.</div>}
          </div>
        </div>

        {pub?.jobs.some((j) => j.error) && (
          <div className="lw-card lwa-fail">
            <div className="lw-k">Failures</div>
            {pub.jobs.filter((j) => j.error).slice(0, 5).map((j) => (
              <div key={j.id} className="lwa-detail-row">
                <span className="job-type">{j.platform}</span>
                <span className="lw-muted">{j.error} · {j.attempts} attempt{j.attempts === 1 ? "" : "s"}</span>
                <button className="lwa-btn" disabled={busy === `retry:${j.id}`} onClick={() => retryJob(j.id)}>Retry</button>
              </div>
            ))}
          </div>
        )}

        <div className="lw-cards">
          {plan.publishingSchedule.slice(0, 9).map((s) => (
            <div key={s.assetKey} className="lw-card lw-slot">
              <div className="lw-slot-day">Day {s.dayOffset}</div>
              <div className="lw-card-h">{s.kind.replace(/_/g, " ")}</div>
              <div className="lw-meta">{s.channel} · week {s.week} · <span className="lw-stage">{s.stage}</span></div>
              <ItemActions assetKey={s.assetKey} />
            </div>
          ))}
        </div>
      </section>

      {/* Market Intelligence — live from Milestone 13 */}
      <section id="market" className="lw-block">
        <h2 className="lw-h2">Market intelligence</h2>
        {market ? (
          <>
            <p className="lw-muted lw-sub">{market.headline}</p>
            <div className="lw-cards">
              {market.opportunities.slice(0, 6).map((o) => (
                <div key={o.id} className="lw-card">
                  <div className="lw-rec-top">
                    <span className="lw-rec-type">{o.kind.replace(/_/g, " ")}</span>
                    <span className="lw-chip">confidence <b className="pub-count">{pct(o.confidence)}</b></span>
                  </div>
                  <div className="lw-card-h">{o.title}</div>
                  <div className="lw-meta">→ {o.recommendedAction}</div>
                  <div className="lw-meta">suggested campaign: {o.suggestedCampaign}</div>
                  <button className="lwa-btn" disabled={busy === `opp:${o.id}`} onClick={() => addOpportunity(o)}>Add to campaign</button>
                </div>
              ))}
            </div>
            <div className="lw-grid2" style={{ marginTop: 14 }}>
              <div className="lw-card">
                <div className="lw-k">Trends</div>
                <ul className="lw-list">{market.trends.slice(0, 5).map((t) => <li key={t.id}>{t.topic} <span className="lw-muted">{pct(t.confidence)}</span></li>)}</ul>
              </div>
              <div className="lw-card">
                <div className="lw-k">Keywords &amp; competitors</div>
                <div className="lw-chips">{market.keywords.slice(0, 6).map((k) => <span key={k.keyword} className="lw-chip">{k.keyword} {pct(k.opportunity)}</span>)}</div>
                <ul className="lw-list">{market.competitors.slice(0, 3).map((c) => <li key={c.name}><b>{c.name}</b> — {c.summary}</li>)}</ul>
              </div>
            </div>
          </>
        ) : <div className="lw-muted">Scanning the market…</div>}
      </section>

      {/* Experiments */}
      <section id="experiments" className="lw-block">
        <h2 className="lw-h2">Experiments</h2>
        <div className="lw-cards">
          {plan.experiments.map((e) => (
            <div key={e.id} className="lw-card">
              <div className="lw-card-h">{e.type.replace(/_/g, " ")}</div>
              <p className="lw-hyp">{e.hypothesis}</p>
              <div className="lw-chips">{e.variants.map((v) => <span key={v.id} className="lw-chip">{v.label}</span>)}</div>
              <div className="lw-meta">{e.winnerVariantId ? `winner: ${e.winnerVariantId}` : "awaiting results"}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Performance — live from the Learning Engine */}
      <section id="performance" className="lw-block">
        <h2 className="lw-h2">Performance</h2>
        <div className="lw-cards">
          {plan.kpis.map((k, i) => (
            <div key={i} className="lw-card lw-perf">
              <div className="lw-perf-metric">{k.metric}</div>
              <div className="lw-perf-target">{k.target}</div>
              <div className="lw-muted">{k.timeframe} · measured post-launch</div>
            </div>
          ))}
        </div>
        <div className="lw-grid2" style={{ marginTop: 14 }}>
          <div className="lw-card">
            <div className="lw-k">Observed</div>
            {perf?.snapshot
              ? <ul className="lw-list">{Object.entries(perf.snapshot).map(([k, v]) => <li key={k}>{k.replace(/([A-Z])/g, " $1").toLowerCase()}: <b>{scalar(v)}</b></li>)}</ul>
              : <div className="lw-muted">No performance data yet — it fills in once published posts report back.</div>}
            {perf?.accuracy != null && <div className="lw-meta">decision accuracy {pct(perf.accuracy)}</div>}
          </div>
          <div className="lw-card">
            <div className="lw-k">What Populr learned</div>
            {perf?.insights?.length
              ? <ul className="lw-list">{perf.insights.slice(0, 5).map((i, n) => <li key={i.id ?? n}>{i.title ?? i.message ?? i.detail}</li>)}</ul>
              : <div className="lw-muted">Nothing learned yet.</div>}
          </div>
        </div>
      </section>

      {/* Automation */}
      <section id="automation" className="lw-block">
        <h2 className="lw-h2">Automation</h2>
        <p className="lw-muted lw-sub">How much of the launch Populr runs without asking. Every toggle is reversible.</p>
        <div className="lw-cards">
          {AUTOMATION_KEYS.map((k) => {
            const on = ws?.automation[k] ?? false;
            return (
              <div key={k} className="lw-card">
                <div className="lw-rec-top lwa-cardtop">
                  <span className="lw-card-h">{AUTOMATION_META[k].label}</span>
                  <button className={"lwa-toggle" + (on ? " on" : "")} role="switch" aria-checked={on} aria-label={AUTOMATION_META[k].label}
                    disabled={!ws || busy === `auto:${k}`} onClick={() => toggle(k, !on)}>
                    <span className="lwa-knob" />
                  </button>
                </div>
                <p className="lw-hyp">{AUTOMATION_META[k].description}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Relationship graph */}
      <section className="lw-block">
        <h2 className="lw-h2">Where every asset comes from</h2>
        <div className="lw-rel">
          <span className="lw-rel-node lw-rel-root">Mission</span><span className="lw-rel-arrow">→</span>
          <span className="lw-rel-node">Campaign: {c0.title.split("—")[1]?.trim() || c0.goal}</span><span className="lw-rel-arrow">→</span>
          <span className="lw-rel-node">Creative Brief</span><span className="lw-rel-arrow">→</span>
          {c0.assetPlan.assets.slice(0, 6).map((a) => (
            <span key={a.key} className="lw-rel-node lw-rel-asset">{a.label}</span>
          ))}
        </div>
      </section>
    </section>
  );
}
