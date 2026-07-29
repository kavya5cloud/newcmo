"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONTENT_FORMATS, FORMAT_META, type ContentFormat } from "@/lib/content/compose";
import type { SocialPlatform } from "@/lib/social/types";
import { humanError, humanThrow } from "@/lib/ui/errors";

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

  /**
   * Edits per version, keyed by tab. Independent by construction: editing the LinkedIn
   * variant cannot touch X, because they are different keys.
   */
  const [edits, setEdits] = useState<Record<string, string>>({});
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [sel, setSel] = useState<{ start: number; end: number; top: number } | null>(null);
  const [refining, setRefining] = useState<string | null>(null);
  /** A refinement not yet accepted. Keeping the original is what makes reject possible. */
  const [pending, setPending] = useState<{ start: number; end: number; original: string; next: string } | null>(null);

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
    } catch (e) { setErr(humanThrow(e)); return null; }
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
    // Publish what the user is looking at. Edits would otherwise be silently discarded.
    const d = await call({ publish: action, overrides: edits }, action);
    if (d?.ok) { setComposed(d.composed); setResults(d.results); setNote(d.message); readMeta(d); }
  }, [call]);

  const active = composed?.variants.find((v) => v.platform === tab);
  const generated = active ? active.text : composed?.body ?? "";
  /** What is actually in the editor: the user's edit if they made one, else the generation. */
  const bodyText = edits[tab] ?? generated;

  // Fresh generations replace the editor; edits to other tabs are untouched.
  useEffect(() => { setEdits({}); setPending(null); setSel(null); }, [composed?.id]);

  const setBody = useCallback((next: string) => {
    setEdits((e) => ({ ...e, [tab]: next }));
  }, [tab]);

  /** Track the selection so the toolbar can act on exactly what is highlighted. */
  const readSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end) { setSel(null); return; }
    // Position the toolbar near the selection without measuring glyphs: line height
    // times the line the selection starts on is close enough and never wrong by much.
    const line = el.value.slice(0, start).split("\n").length - 1;
    setSel({ start, end, top: Math.max(0, line * 27 - el.scrollTop) });
  }, []);

  const refine = useCallback(async (action: string) => {
    const el = editorRef.current;
    if (!el) return;
    const start = sel?.start ?? el.selectionStart;
    const end = sel?.end ?? el.selectionEnd;
    const text = bodyText;
    const selection = text.slice(start, end);
    if (!selection && action !== "continue") return;

    setRefining(action); setErr(null);
    try {
      const r = await fetch("/api/content/refine", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action, selection,
          before: text.slice(0, start), after: text.slice(end),
          platform: tab || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(String(d.hint || "That edit didn't go through. Your text is unchanged.")); return; }

      const insert = action === "continue" ? `${selection}${selection ? " " : ""}${d.text}` : d.text;
      // Show the change in place, but hold it as pending until it is accepted — an AI
      // edit that silently overwrites your sentence is one you cannot get back.
      setPending({ start, end, original: selection, next: insert });
      setBody(text.slice(0, start) + insert + text.slice(end));
      setSel(null);
    } catch { setErr("network error — your text is unchanged"); }
    finally { setRefining(null); }
  }, [sel, bodyText, tab, setBody]);

  const rejectPending = useCallback(() => {
    if (!pending) return;
    const text = bodyText;
    setBody(text.slice(0, pending.start) + pending.original + text.slice(pending.start + pending.next.length));
    setPending(null);
  }, [pending, bodyText, setBody]);

  const edited = edits[tab] !== undefined && edits[tab] !== generated;

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

            {/* The document is the editor. Highlight anything to bring AI to it. */}
            <div className="cmp-editor">
              <textarea
                ref={editorRef}
                className="cmp-body cmp-editable"
                value={bodyText}
                aria-label="Content"
                onChange={(e) => { setBody(e.target.value); setPending(null); }}
                onSelect={readSelection}
                onKeyUp={readSelection}
                onMouseUp={readSelection}
                onBlur={() => setTimeout(() => setSel(null), 160)}
                rows={Math.max(6, bodyText.split("\n").length + 2)}
              />

              {sel && !pending && (
                <div className="cmp-float" style={{ top: sel.top }} role="toolbar" aria-label="AI edits">
                  {([
                    ["rewrite", "Rewrite"], ["shorten", "Shorten"], ["expand", "Expand"],
                    ["improve", "Improve"], ["professional", "Professional"], ["casual", "Casual"],
                    ["engaging", "Engaging"], ["grammar", "Grammar"], ["cta", "Make a CTA"],
                    ["hashtags", "Hashtags"], ["continue", "Continue"],
                  ] as const).map(([id, label]) => (
                    <button key={id} className="cmp-float-b" disabled={refining !== null}
                      onMouseDown={(e) => e.preventDefault()} onClick={() => refine(id)}>
                      {refining === id ? "…" : label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {pending && (
              <div className="cmp-pending">
                <span>AI edit applied.</span>
                <button className="cmp-alt cmp-accept" onClick={() => setPending(null)}>Keep</button>
                <button className="cmp-alt" onClick={rejectPending}>Undo</button>
              </div>
            )}

            {tab === "" && composed.hashtags.length > 0 && <p className="cmp-tags">{composed.hashtags.join("  ")}</p>}
            {active && !active.fits && <p className="cmp-note">{active.note}</p>}
            {edited && (
              <p className="cmp-edited">
                Edited. <button className="cmp-linkbtn" onClick={() => { setEdits((e) => { const n = { ...e }; delete n[tab]; return n; }); setPending(null); }}>Revert to the original</button>
              </p>
            )}
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
