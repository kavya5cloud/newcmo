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

/** API error codes are for logs. People get a sentence, and a way forward. */
function humanError(d: { error?: string; hint?: string }, status: number): string {
  if (d.hint) return d.hint;
  switch (d.error) {
    case "rate_limited": return "You're generating faster than we can keep up. Give it a minute and try again.";
    case "missing_prompt": return "Write what you want to say first.";
    case "prompt_too_long": return "That prompt is too long — trim it to a sentence or two.";
    case "no_platforms": return "Connect a platform in Cross-Post before publishing.";
    case "compose_failed": return "Generation failed. Your prompt is still here — try again.";
    default: return status === 429
      ? "You're generating faster than we can keep up. Give it a minute and try again."
      : "Something went wrong generating that. Your prompt is still here — try again.";
  }
}

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
      if (!r.ok || d.error) { setErr(humanError(d, r.status)); return null; }
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

      {err && <div className="cmp-err" role="alert">{err}</div>}
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
          {/* The piece is the page, not a card. Chrome around writing competes with it. */}
          <article className="cmp-piece">
            <h2 className="cmp-title">{composed.title}</h2>
            {meta && (
              <p className="cmp-meta">
                <span className="cmp-src">
                  {meta.source === "llm" ? `${meta.provider}${meta.model ? ` · ${meta.model}` : ""}` : "built-in composer"}
                </span>
                <span className="cmp-conf">{Math.round(meta.confidence * 100)}% confident</span>
                <span className="cmp-reason">{meta.reasoning}</span>
              </p>
            )}
            {meta?.degradedReason && <p className="cmp-degraded">{meta.degradedReason}</p>}
            <div className="cmp-body">{composed.body}</div>
            <p className="cmp-tags">{composed.hashtags.join("  ")}</p>
          </article>

          {/* Publishing is the last step of writing, so it sits with the writing —
              one primary action, the rest as quiet text. */}
          <div className="cmp-publish">
            <button className="cmp-go" disabled={busy === "now"} onClick={() => publish("now")}>
              {busy === "now" ? "Publishing…" : "Publish everywhere"}
            </button>
            <button className="cmp-alt" disabled={busy === "schedule"} onClick={() => publish("schedule")}>
              {busy === "schedule" ? "Scheduling…" : "Schedule"}
            </button>
            <button className="cmp-alt" disabled={busy === "draft"} onClick={() => publish("draft")}>
              {busy === "draft" ? "Saving…" : "Save as draft"}
            </button>
            <a className="cmp-alt" href="/studio/social">Drafts</a>
          </div>

          {results && (
            <div className="cmp-result">
              {results.map((r) => (
                <p key={r.jobId}>
                  <b>{r.platform}</b> — {r.state}{r.at ? ` · ${when(r.at)}` : ""}
                </p>
              ))}
              <p className="lw-muted">Retries, failures and approvals live in <a href="/studio/social">Cross-Post</a>.</p>
            </div>
          )}

          {/* Everything the piece implies, below the fold of the writing: hairlines,
              no cards, no nesting. */}
          {composed.variants.length > 0 && (
            <section className="cmp-sub">
              <h3 className="cmp-sub-h">Per platform</h3>
              {composed.variants.map((v) => (
                <div key={v.platform} className="cmp-variant">
                  <div className="cmp-variant-top">
                    <span className="cmp-variant-p">{v.platform}</span>
                    <span className={"cmp-count" + (v.fits ? "" : " over")}>{v.length}/{v.limit}</span>
                  </div>
                  <div className="cmp-body cmp-body-sm">{v.text}</div>
                  {!v.fits && <p className="cmp-note">{v.note}</p>}
                </div>
              ))}
            </section>
          )}

          <section className="cmp-sub">
            <h3 className="cmp-sub-h">Then</h3>
            <dl className="cmp-dl">
              <dt>Call to action</dt>
              <dd>{composed.ctas.join(" · ")}</dd>
              <dt>Schedule</dt>
              <dd>
                {composed.schedule.length
                  ? composed.schedule.map((sl) => <span key={sl.platform} className="cmp-slot"><b>{sl.platform}</b> {when(sl.at)} <span className="lw-muted">{sl.rationale}</span></span>)
                  : <span className="lw-muted">Connect a platform to get a schedule.</span>}
              </dd>
              <dt>Campaign</dt>
              <dd>
                {composed.campaignSuggestion.title} <span className="lw-muted">{composed.campaignSuggestion.rationale}</span>{" "}
                <a href="/studio/launch#campaigns">Open Launch Workspace →</a>
              </dd>
            </dl>
          </section>
        </div>
      )}
    </div>
  );
}
