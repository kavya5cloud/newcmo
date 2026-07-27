"use client";
import { useCallback, useEffect, useState } from "react";
import { CONTENT_FORMATS, FORMAT_META, type ContentFormat } from "@/lib/content/compose";
import type { SocialPlatform } from "@/lib/social/types";

// The Content Composer. One prompt → the piece, a variant per connected platform sized to
// that platform's real limit, hashtags, CTAs, a schedule and a campaign suggestion — then
// straight into the existing Publishing Engine (drafts, scheduling, immediate publish).
//
// Every control here performs a real request. There is no local-only state pretending to be
// a result: what you see came from /api/content/compose, and publishing goes through the
// same adapters as everything else in the product.

type Variant = { platform: SocialPlatform; text: string; length: number; limit: number; fits: boolean; requiresAsset: boolean; note: string };
type Composed = {
  id: string; format: ContentFormat; title: string; body: string;
  variants: Variant[]; hashtags: string[]; ctas: string[];
  schedule: { platform: SocialPlatform; at: number; rationale: string }[];
  campaignSuggestion: { title: string; goal: string; rationale: string };
};
type Result = { platform: SocialPlatform; jobId: string; state: string; at: number | null };
/** Where the words came from. Shown because a founder should never have to guess. */
type Provenance = {
  source: "llm" | "deterministic"; provider: string | null; model: string | null;
  confidence: number; reasoning: string; degradedReason?: string;
};

/** Real prompts, not placeholders — a first-time user should be able to click one. */
const SEED_PROMPTS = [
  "We shipped a feature that removes the manual step our users hate most",
  "Why we rebuilt our onboarding, and what changed",
  "A short launch announcement for our newest release",
  "Explain what we do to someone who has never heard of us",
];

const when = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function Composer({ initialFormat = "post" as ContentFormat, heading }: { initialFormat?: ContentFormat; heading?: string }) {
  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState<ContentFormat>(initialFormat);
  const [audience, setAudience] = useState("seed-stage founders");
  const [composed, setComposed] = useState<Composed | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<Provenance | null>(null);

  useEffect(() => {
    fetch("/api/social/dashboard").then((r) => r.json())
      .then((d) => { if (d?.ok) setConnected([...new Set((d.accounts as { platform: string; status: string }[]).filter((a) => a.status === "connected").map((a) => a.platform))]); })
      .catch(() => {});
  }, []);

  const call = useCallback(async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/content/compose", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, format, audience, ...body }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(String(d.hint || d.error || `request failed (${r.status})`)); return null; }
      return d;
    } catch { setErr("network error — check your connection"); return null; }
    finally { setBusy(null); }
  }, [prompt, format, audience]);

  const generate = useCallback(async () => {
    if (!prompt.trim()) { setErr("Describe what you want to say first."); return; }
    const d = await call({}, "gen");
    if (d?.ok) {
      setComposed(d.composed); setResults(null); if (d.note) setNote(d.note);
      setMeta({ source: d.source, provider: d.provider, model: d.model, confidence: d.confidence, reasoning: d.reasoning, degradedReason: d.degradedReason });
    }
  }, [call, prompt]);

  const publish = useCallback(async (action: "draft" | "schedule" | "now") => {
    const d = await call({ publish: action }, action);
    if (d?.ok) {
      setComposed(d.composed); setResults(d.results); setNote(d.message);
      setMeta({ source: d.source, provider: d.provider, model: d.model, confidence: d.confidence, reasoning: d.reasoning, degradedReason: d.degradedReason });
    }
  }, [call]);

  return (
    <div className="cmp">
      <div className="cmp-form">
        <label className="lw-k" htmlFor="cmp-prompt">{heading ?? "What do you want to say?"}</label>
        <textarea
          id="cmp-prompt" className="mkt-input cmp-prompt" rows={3} value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. We shipped an AI CMO that plans and publishes a whole launch from one mission."
        />

        <div className="cmp-controls">
          <select className="lwa-select" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as ContentFormat)}>
            {CONTENT_FORMATS.map((f) => <option key={f} value={f}>{FORMAT_META[f].label}</option>)}
          </select>
          <input className="mkt-input cmp-audience" aria-label="Audience" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="audience" />
          <button className="st-card-cta st-card-gen" onClick={generate} disabled={busy === "gen"}>
            {busy === "gen" ? "Writing…" : "Generate"}
          </button>
        </div>
        <p className="lw-muted cmp-hint">{FORMAT_META[format].blurb}</p>

        {connected.length > 0
          ? <div className="lw-chips">{connected.map((p) => <span key={p} className="lw-chip">{p}</span>)}</div>
          : <p className="lw-muted cmp-hint">No platforms connected — connect one in Cross-Post to get sized variants and one-click publishing.</p>}
      </div>

      {err && <div className="lw-card lwa-note lwa-sev-critical">{err}</div>}
      {note && <div className="lw-card lwa-note">{note}</div>}

      {/* Empty state that teaches: real prompts, one click to try one. */}
      {!composed && !busy && (
        <div className="cmp-empty">
          <p className="lw-muted">Start from one of these, or write your own.</p>
          <div className="cmp-seeds">
            {SEED_PROMPTS.map((p) => (
              <button key={p} type="button" className="cmp-seed" onClick={() => setPrompt(p)}>{p}</button>
            ))}
          </div>
        </div>
      )}

      {composed && (
        <div className="cmp-out">
          {meta && (
            <div className="cmp-meta">
              <span className="cmp-src">
                {meta.source === "llm" ? `${meta.provider}${meta.model ? ` · ${meta.model}` : ""}` : "built-in composer"}
              </span>
              <span className="cmp-conf">{Math.round(meta.confidence * 100)}% confident</span>
              <span className="cmp-reason">{meta.reasoning}</span>
              {meta.degradedReason && <span className="cmp-degraded">{meta.degradedReason}</span>}
            </div>
          )}
          <div className="lw-card">
            <div className="lw-k">{FORMAT_META[composed.format].label}</div>
            <div className="lw-card-h">{composed.title}</div>
            <pre className="cmp-body">{composed.body}</pre>
            <div className="lw-chips">{composed.hashtags.map((h) => <span key={h} className="lw-chip">{h}</span>)}</div>
          </div>

          {composed.variants.length > 0 && (
            <>
              <h3 className="lw-h2 cmp-h3">Platform variants</h3>
              <div className="lw-cards">
                {composed.variants.map((v) => (
                  <div key={v.platform} className="lw-card">
                    <div className="lw-rec-top lwa-cardtop">
                      <span className="lw-card-h">{v.platform}</span>
                      <span className={"job-state " + (v.fits ? "job-ok" : "job-warn")}>{v.length}/{v.limit}</span>
                    </div>
                    <pre className="cmp-body cmp-body-sm">{v.text}</pre>
                    <div className="lw-meta">{v.note}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="lw-grid2 cmp-grid">
            <div className="lw-card">
              <div className="lw-k">Call to action</div>
              <ul className="lw-list">{composed.ctas.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
            <div className="lw-card">
              <div className="lw-k">Schedule</div>
              {composed.schedule.length
                ? <ul className="lw-list">{composed.schedule.map((s) => <li key={s.platform}><b>{s.platform}</b> — {when(s.at)}<br /><span className="lw-muted">{s.rationale}</span></li>)}</ul>
                : <div className="lw-muted">Connect a platform to get a schedule.</div>}
            </div>
          </div>

          <div className="lw-card">
            <div className="lw-k">Campaign suggestion</div>
            <div className="lw-card-h">{composed.campaignSuggestion.title}</div>
            <p className="lw-hyp">{composed.campaignSuggestion.rationale}</p>
            <div className="lwa-actions">
              <a className="lwa-btn" href="/studio/launch#campaigns">Open Launch Workspace</a>
            </div>
          </div>

          <div className="lwa-actions cmp-actions">
            <button className="st-card-cta st-card-gen" disabled={busy === "now"} onClick={() => publish("now")}>
              {busy === "now" ? "Publishing…" : "Publish everywhere"}
            </button>
            <button className="lwa-btn" disabled={busy === "schedule"} onClick={() => publish("schedule")}>
              {busy === "schedule" ? "Scheduling…" : "Schedule"}
            </button>
            <button className="lwa-btn" disabled={busy === "draft"} onClick={() => publish("draft")}>
              {busy === "draft" ? "Saving…" : "Save as draft"}
            </button>
            <a className="lwa-btn" href="/studio/social">Open drafts</a>
          </div>

          {results && (
            <div className="lw-card">
              <div className="lw-k">Result</div>
              <ul className="lw-list">
                {results.map((r) => (
                  <li key={r.jobId}>
                    <b>{r.platform}</b> — {r.state}{r.at ? ` · ${when(r.at)}` : ""} <span className="lw-muted">{r.jobId}</span>
                  </li>
                ))}
              </ul>
              <div className="lw-meta">Retries, failures and approvals for these live in <a href="/studio/social">Cross-Post</a>.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
