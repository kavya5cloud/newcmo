"use client";
import { useEffect, useRef, useState } from "react";

// Publishing Dashboard (Cross-Platform Publishing) — connect accounts, compose + publish
// now or schedule (timezone-aware), and watch the queue, calendar and history. Live from
// the real engine (/api/social/*).

type Platform = { platform: string; maxText: number; maxAssets: number; requiresAsset: boolean; allowsScheduling: boolean };
type Account = { id: string; platform: string; handle: string; status: string };
type Metrics = { queued: number; scheduled: number; publishing: number; published: number; failed: number; deadLetter: number; retrying: number; avgAttempts: number };
type Job = { id: string; platform: string; state: string; attempts: number; text: string; error: string | null };
type CalItem = { id: string; platform: string; localTime: string | null; text: string };
type Hist = { id: string; platform: string; state: string; permalink: string | null; attempts: number };
type Draft = { id: string; title: string; platforms: string[]; content: { text: string }; updatedAt: number };

const LABEL: Record<string, string> = { linkedin: "LinkedIn", instagram_business: "Instagram", facebook_pages: "Facebook", x: "X", threads: "Threads", pinterest: "Pinterest" };
const STATE_CLASS: Record<string, string> = { published: "job-ok", failed: "job-bad", dead_letter: "job-bad", cancelled: "job-muted", scheduled: "job-warn", queued: "job-warn", publishing: "job-warn", connected: "job-ok", disconnected: "job-muted", expired: "job-warn", error: "job-bad" };

export default function SocialDashboard() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [calendar, setCalendar] = useState<CalItem[]>([]);
  const [history, setHistory] = useState<Hist[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [text, setText] = useState("Big news for founders — Populr is live.");
  const [account, setAccount] = useState("");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const seeded = useRef(false);

  async function refresh() {
    const [a, d, dr] = await Promise.all([
      fetch("/api/social/accounts", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/social/dashboard", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/social/drafts", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    ]);
    if (a.platforms) setPlatforms(a.platforms);
    if (a.accounts) { setAccounts(a.accounts); if (a.accounts[0] && !account) setAccount(a.accounts[0].id); }
    if (d.metrics) setMetrics(d.metrics);
    if (d.jobs) setJobs(d.jobs);
    if (d.calendar) setCalendar(d.calendar);
    if (d.history) setHistory(d.history);
    if (dr.drafts) setDrafts(dr.drafts);
  }

  // ---- Draft Manager ----
  async function saveDraft() {
    const acc = accounts.find((a) => a.id === account);
    await fetch("/api/social/drafts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: text.slice(0, 40) || "Untitled", platforms: acc ? [acc.platform] : [], content: { text, assetIds: [] } }),
    }).catch(() => {});
    await refresh();
  }
  async function loadDraft(d: Draft) { setText(d.content.text); }
  async function deleteDraft(id: string) {
    await fetch(`/api/social/drafts/${id}`, { method: "DELETE" }).catch(() => {});
    await refresh();
  }

  useEffect(() => {
    (async () => {
      await refresh();
      if (!seeded.current) { seeded.current = true; /* leave connecting to the user */ }
    })();
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function connect(platform: string) {
    setBusy(true);
    await fetch("/api/social/accounts/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ platform }) }).catch(() => {});
    await refresh(); setBusy(false);
  }
  async function disconnect(id: string) {
    setBusy(true);
    await fetch("/api/social/accounts/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: id }) }).catch(() => {});
    await refresh(); setBusy(false);
  }
  async function publish(schedule: boolean) {
    const acc = accounts.find((a) => a.id === account);
    if (!acc) return;
    setBusy(true);
    const body: Record<string, unknown> = { accountId: acc.id, platform: acc.platform, content: { text, assetIds: [] } };
    if (schedule && when) { body.at = when.replace("T", "T"); body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; }
    await fetch(`/api/social/${schedule ? "schedule" : "publish"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    await refresh(); setBusy(false);
  }
  async function jobAction(action: "retry" | "cancel", jobId: string) {
    await fetch(`/api/social/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId }) }).catch(() => {});
    await refresh();
  }

  const m = metrics;
  return (
    <section className="st-section lw">
      <header className="st-shead">
        <span className="label">Execution · Cross-Post</span>
        <h1>Cross-Platform Publishing</h1>
        <p>Connect social accounts, then publish now or schedule (timezone-aware) to LinkedIn, Instagram, Facebook, X, Threads and Pinterest. Tokens are stored encrypted; every post runs through a platform adapter with retries and a dead-letter queue.</p>
      </header>

      {m && (
        <div className="job-tiles">
          <div className="job-tile"><div className="job-tile-v">{accounts.filter((a) => a.status === "connected").length}</div><div className="job-tile-k">Accounts</div></div>
          <div className="job-tile"><div className="job-tile-v">{m.scheduled}</div><div className="job-tile-k">Scheduled</div></div>
          <div className="job-tile"><div className="job-tile-v">{m.published}</div><div className="job-tile-k">Published</div></div>
          <div className="job-tile"><div className="job-tile-v">{m.retrying}</div><div className="job-tile-k">Retrying</div></div>
          <div className="job-tile"><div className="job-tile-v">{m.deadLetter}</div><div className="job-tile-k">Dead-letter</div></div>
        </div>
      )}

      <section className="lw-block">
        <h2 className="lw-h2">Connected Accounts</h2>
        <div className="st-grid">
          {platforms.map((p) => {
            const acc = accounts.find((a) => a.platform === p.platform && a.status === "connected");
            return (
              <div key={p.platform} className="lw-card">
                <div className="lw-card-h">{LABEL[p.platform] ?? p.platform}</div>
                <div className="lw-meta">{acc ? acc.handle : "not connected"} · {p.maxText} chars{p.requiresAsset ? " · media required" : ""}</div>
                <button className="st-card-cta st-card-gen" disabled={busy} onClick={() => (acc ? disconnect(acc.id) : connect(p.platform))}>{acc ? "Disconnect" : "Connect"}</button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="lw-block">
        <h2 className="lw-h2">Compose</h2>
        <div className="lw-card" style={{ maxWidth: 640 }}>
          <textarea className="eam-field" style={{ width: "100%", minHeight: 80, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 9, color: "var(--fg)", padding: 11, fontFamily: "inherit" }} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="lw-chips" style={{ marginTop: 10 }}>
            <select className="job-select" value={account} onChange={(e) => setAccount(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--fg)", padding: "8px 10px" }}>
              {accounts.filter((a) => a.status === "connected").map((a) => <option key={a.id} value={a.id}>{LABEL[a.platform] ?? a.platform} · {a.handle}</option>)}
            </select>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--fg)", padding: "8px 10px" }} />
            <button className="st-card-cta st-card-gen" disabled={busy || !account} onClick={() => publish(false)}>Publish now</button>
            <button className="st-card-cta st-card-gen" disabled={busy || !account || !when} onClick={() => publish(true)}>Schedule</button>
            <button className="st-card-cta st-card-gen" disabled={busy || !text.trim()} onClick={saveDraft}>Save draft</button>
          </div>
        </div>
      </section>

      {/* Draft Manager */}
      <section className="lw-block">
        <h2 className="lw-h2">Draft Manager</h2>
        <div className="job-list">
          {drafts.length ? drafts.map((d) => (
            <div key={d.id} className="job-row">
              <span className="job-type">{d.title}</span>
              <span className="job-state job-muted">{d.platforms.map((p) => LABEL[p] ?? p).join(", ") || "no platform"}</span>
              <span className="lw-muted">{d.content.text.slice(0, 70)}</span>
              <span className="job-meta">
                <button className="lw-chip" onClick={() => loadDraft(d)}>load</button>
                <button className="lw-chip" onClick={() => deleteDraft(d.id)}>delete</button>
              </span>
            </div>
          )) : <div className="lw-muted">No drafts yet — write something above and hit “Save draft”.</div>}
        </div>
      </section>

      {/* Integration Settings */}
      <section className="lw-block">
        <h2 className="lw-h2">Integration Settings</h2>
        <div className="job-list">
          {accounts.length ? accounts.map((a) => (
            <div key={a.id} className="job-row">
              <span className="job-type">{LABEL[a.platform] ?? a.platform}</span>
              <span className={"job-state " + (STATE_CLASS[a.status] ?? "")}>{a.status}</span>
              <span className="lw-muted">{a.handle}</span>
              <span className="job-meta">
                <button className="lw-chip" onClick={() => (a.status === "connected" ? disconnect(a.id) : connect(a.platform))}>
                  {a.status === "connected" ? "disconnect" : "reconnect"}
                </button>
              </span>
            </div>
          )) : <div className="lw-muted">No accounts connected yet.</div>}
        </div>
      </section>

      <section className="lw-block">
        <h2 className="lw-h2">Calendar</h2>
        <div className="job-list">
          {calendar.length ? calendar.map((c) => (
            <div key={c.id} className="job-row"><span className="job-type">{LABEL[c.platform] ?? c.platform}</span><span className="job-state job-warn">scheduled</span><span className="lw-muted">{c.localTime}</span><span className="job-meta">{c.text}</span></div>
          )) : <div className="lw-muted">Nothing scheduled.</div>}
        </div>
      </section>

      <section className="lw-block">
        <h2 className="lw-h2">Queue</h2>
        <div className="job-list">
          {jobs.length ? jobs.map((j) => (
            <div key={j.id} className="job-row">
              <span className="job-type">{LABEL[j.platform] ?? j.platform}</span>
              <span className={"job-state " + (STATE_CLASS[j.state] ?? "")}>{j.state.replace(/_/g, " ")}</span>
              <span className="lw-muted">{j.text}{j.attempts > 1 ? ` · ${j.attempts} tries` : ""}{j.error ? ` · ${j.error}` : ""}</span>
              <span className="job-meta">
                {(j.state === "failed" || j.state === "dead_letter") && <button className="lw-chip" onClick={() => jobAction("retry", j.id)}>retry</button>}
                {(j.state === "queued" || j.state === "scheduled") && <button className="lw-chip" onClick={() => jobAction("cancel", j.id)}>cancel</button>}
              </span>
            </div>
          )) : <div className="lw-muted">No jobs yet.</div>}
        </div>
      </section>

      <section className="lw-block">
        <h2 className="lw-h2">Publish History</h2>
        <div className="job-list">
          {history.length ? history.map((h) => (
            <div key={h.id} className="job-row"><span className="job-type">{LABEL[h.platform] ?? h.platform}</span><span className={"job-state " + (STATE_CLASS[h.state] ?? "")}>{h.state.replace(/_/g, " ")}</span><span className="lw-muted">{h.permalink ?? "—"}</span><span className="job-meta">{h.attempts} attempt{h.attempts === 1 ? "" : "s"}</span></div>
          )) : <div className="lw-muted">No history yet.</div>}
        </div>
      </section>
    </section>
  );
}
