"use client";
import { useCallback, useEffect, useState } from "react";
import { CONTENT_FORMATS, FORMAT_META, type ContentFormat } from "@/lib/content/compose";
import type { SocialPlatform } from "@/lib/social/types";

// The Content Workspace: write → review → publish.
//
// Everything the API can infer is inferred. Format and audience still exist and still
// reach /api/content/compose unchanged — they moved behind Options, because someone
// arriving to write a post should not first be asked to configure one. The generated
// piece and its platform variants became one document with tabs rather than a stack of
// cards, so reviewing feels like reading rather than auditing.
//
// No functionality was removed. Every control that existed still exists.

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
  const [advanced, setAdvanced] = useState(false);

  const [composed, setComposed] = useState<Composed | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<Provenance | null>(null);
  /** "" is the full piece; otherwise the platform whose variant is being read. */
  const [tab, setTab] = useState<string>("");
  const [details, setDetails] = useState(false);

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

  const readMeta = (d: Record<string, unknown>) => setMeta({
    source: d.source as Provenance["source"], provider: d.provider as string | null,
    model: d.model as string | null, confidence: d.confidence as number,
    reasoning: d.reasoning as string, degradedReason: d.degradedReason as string | undefined,
  });

  const generate = useCallback(async () => {
    if (!prompt.trim()) { setErr("Write what you want to create first."); return; }
    const d = await call({}, "gen");
    if (d?.ok) { setComposed(d.composed); setResults(null); setTab(""); if (d.note) setNote(d.note); readMeta(d); }
  }, [call, prompt]);

  const publish = useCallback(async (action: "draft" | "schedule" | "now") => {
    const d = await call({ publish: action }, action);
    if (d?.ok) { setComposed(d.composed); setResults(d.results); setNote(d.message); readMeta(d); }
  }, [call]);

  const active = composed?.variants.find((v) => v.platform === tab);
  const bodyText = active ? active.text : composed?.body ?? "";

  return (
    <div className="cmp">
      {/* Write. One question, one action. */}
      <div className="cmp-write">
        <label className="cmp-ask" htmlFor="cmp-prompt">{heading ?? "What do you want to create?"}</label>
        <textarea
          id="cmp-prompt" className="cmp-prompt" rows={composed ? 2 : 4} value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A launch announcement for the feature we shipped this week…"
        />

        <div className="cmp-go-row">
          <button className="cmp-go" onClick={generate} disabled={busy === "gen"}>
            {busy === "gen" ? "Writing…" : "Generate"}
          </button>
          <button className="cmp-adv-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
            {advanced ? "Hide options" : "Options"}
          </button>
        </div>

        {/* Everything Populr already infers, still changeable when someone wants to. */}
        {advanced && (
          <div className="cmp-adv">
            <label className="cmp-adv-field">
              <span>Format</span>
              <select className="lwa-select" value={format} onChange={(e) => setFormat(e.target.value as ContentFormat)}>
                {CONTENT_FORMATS.map((f) => <option key={f} value={f}>{FORMAT_META[f].label}</option>)}
              </select>
            </label>
            <label className="cmp-adv-field">
              <span>Audience</span>
              <input className="mkt-input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="who is this for?" />
            </label>
            <p className="cmp-adv-note">
              Left alone, Populr infers both from your site and what has performed before.
              {connected.length === 0 && " No platforms are connected yet — connect one in Cross-Post for sized variants and one-click publishing."}
            </p>
          </div>
        )}

        {!composed && !busy && (
          <div className="cmp-seeds">
            {SEED_PROMPTS.map((p) => (
              <button key={p} type="button" className="cmp-seed" onClick={() => setPrompt(p)}>{p}</button>
            ))}
          </div>
        )}
      </div>

      {err && <div className="cmp-err" role="alert">{err}</div>}
      {note && <div className="cmp-note-line">{note}</div>}

      {/* Review. One document; each platform is a tab, not another card. */}
      {composed && (
        <div className="cmp-doc">
          {composed.variants.length > 0 && (
            <div className="cmp-tabs" role="tablist" aria-label="Version">
              <button role="tab" aria-selected={tab === ""} className={"cmp-tab" + (tab === "" ? " on" : "")} onClick={() => setTab("")}>
                Full piece
              </button>
              {composed.variants.map((v) => (
                <button key={v.platform} role="tab" aria-selected={tab === v.platform}
                  className={"cmp-tab" + (tab === v.platform ? " on" : "")} onClick={() => setTab(v.platform)}>
                  {v.platform}
                  <span className={"cmp-tab-n" + (v.fits ? "" : " over")}>{v.length}</span>
                </button>
              ))}
            </div>
          )}

          <article className="cmp-piece">
            {tab === "" && <h2 className="cmp-title">{composed.title}</h2>}
            <div className="cmp-body">{bodyText}</div>
            {tab === "" && composed.hashtags.length > 0 && <p className="cmp-tags">{composed.hashtags.join("  ")}</p>}
            {active && !active.fits && <p className="cmp-note">{active.note}</p>}
          </article>

          {meta && (
            <p className="cmp-meta">
              <span className="cmp-src">{meta.source === "llm" ? `${meta.provider}${meta.model ? ` · ${meta.model}` : ""}` : "built-in composer"}</span>
              <span className="cmp-conf">{Math.round(meta.confidence * 100)}% confident</span>
              <span className="cmp-reason">{meta.reasoning}</span>
            </p>
          )}
          {meta?.degradedReason && <p className="cmp-degraded">{meta.degradedReason}</p>}

          {/* Publish. The last step of writing, not a separate screen. */}
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
            <button className="cmp-adv-toggle" type="button" aria-expanded={details} onClick={() => setDetails((v) => !v)}>
              {details ? "Hide details" : "Details"}
            </button>
          </div>

          {results && (
            <div className="cmp-result">
              {results.map((r) => (
                <p key={r.jobId}><b>{r.platform}</b> — {r.state}{r.at ? ` · ${when(r.at)}` : ""}</p>
              ))}
              <p className="lw-muted">Retries, failures and approvals live in <a href="/studio/social">Cross-Post</a>.</p>
            </div>
          )}

          {/* Details. Present, not in the way. */}
          {details && (
            <section className="cmp-sub">
              <dl className="cmp-dl">
                <dt>Call to action</dt>
                <dd>{composed.ctas.join(" · ")}</dd>
                <dt>Schedule</dt>
                <dd>
                  {composed.schedule.length
                    ? composed.schedule.map((sl) => (
                      <span key={sl.platform} className="cmp-slot"><b>{sl.platform}</b> {when(sl.at)} <span className="lw-muted">{sl.rationale}</span></span>
                    ))
                    : <span className="lw-muted">Connect a platform to get a schedule.</span>}
                </dd>
                <dt>Campaign</dt>
                <dd>
                  {composed.campaignSuggestion.title} <span className="lw-muted">{composed.campaignSuggestion.rationale}</span>{" "}
                  <a href="/studio/launch#campaigns">Open Launch Workspace →</a>
                </dd>
              </dl>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
