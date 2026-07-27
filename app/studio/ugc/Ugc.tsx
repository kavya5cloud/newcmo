"use client";
import { useCallback, useEffect, useState } from "react";
import {
  CREATOR_STYLES, CREATOR_STYLE_META, FORMAT_META, UGC_FORMATS, VOICE_STYLES, VOICE_STYLE_META,
  type CreatorStyle, type UgcFormat, type UgcPackage, type UgcVersion, type VoiceStyle,
} from "@/lib/ugc/types";

// The UGC workflow: brief → hooks → scripted versions → edit → approve → draft → schedule
// or publish. Everything past "draft" is the existing Publishing Engine, so UGC gets the
// same retries, approvals and adapters as every other post.

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function UgcWorkspace() {
  const [product, setProduct] = useState("");
  const [audience, setAudience] = useState("seed-stage founders");
  const [outcome, setOutcome] = useState("");
  const [objection, setObjection] = useState("");
  const [format, setFormat] = useState<UgcFormat>("testimonial");
  const [creatorStyle, setCreatorStyle] = useState<CreatorStyle>("founder");
  const [voiceStyle, setVoiceStyle] = useState<VoiceStyle>("conversational");
  const [versions, setVersions] = useState(3);

  const [pkg, setPkg] = useState<UgcPackage | null>(null);
  const [recent, setRecent] = useState<UgcPackage[]>([]);
  const [openVersion, setOpenVersion] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ source: string; provider: string | null; model: string | null; confidence: number; reasoning: string; degradedReason?: string } | null>(null);

  const loadRecent = useCallback(async () => {
    const d = await fetch("/api/ugc").then((r) => r.json()).catch(() => null);
    if (d?.ok) setRecent(d.packages);
  }, []);

  useEffect(() => {
    loadRecent();
    fetch("/api/social/dashboard").then((r) => r.json())
      .then((d) => {
        if (!d?.ok) return;
        const live = [...new Set((d.accounts as { platform: string; status: string }[]).filter((a) => a.status === "connected").map((a) => a.platform))];
        setConnected(live);
        setPlatforms(live);
      })
      .catch(() => {});
  }, [loadRecent]);

  const post = useCallback(async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/ugc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(String(d.hint || d.error || `request failed (${r.status})`)); return null; }
      return d;
    } catch { setErr("network error — check your connection"); return null; }
    finally { setBusy(null); }
  }, []);

  const generate = useCallback(async () => {
    if (!product.trim() || !outcome.trim()) { setErr("Name the product and the change it creates — the script is built from both."); return; }
    const d = await post({ op: "generate", product, audience, outcome, objection, format, creatorStyle, voiceStyle, versions }, "gen");
    if (d?.ok) {
      setPkg(d.package); setOpenVersion(d.package.versions[0]?.id ?? null); loadRecent();
      setMeta({ source: d.source, provider: d.provider, model: d.model, confidence: d.confidence, reasoning: d.reasoning, degradedReason: d.degradedReason });
    }
  }, [post, product, audience, outcome, objection, format, creatorStyle, voiceStyle, versions, loadRecent]);

  const decide = useCallback(async (versionId: string, op: "approve" | "reject") => {
    if (!pkg) return;
    const d = await post({ op, id: pkg.id, versionId }, `d:${versionId}`);
    if (d?.ok) { setPkg(d.package); setNote(op === "approve" ? "Approved. Send it to drafts to schedule or publish it." : "Rejected."); }
  }, [post, pkg]);

  const saveEdit = useCallback(async (versionId: string) => {
    if (!pkg) return;
    const d = await post({ op: "edit", id: pkg.id, versionId, caption: captionDraft }, `e:${versionId}`);
    if (d?.ok) { setPkg(d.package); setEditing(null); setNote("Saved."); }
  }, [post, pkg, captionDraft]);

  const toDraft = useCallback(async (versionId: string) => {
    if (!pkg) return;
    const d = await post({ op: "to_draft", id: pkg.id, versionId, platforms }, `t:${versionId}`);
    if (d?.ok) setNote(d.message);
  }, [post, pkg, platforms]);

  const renderVersion = (v: UgcVersion) => {
    const open = openVersion === v.id;
    return (
      <div key={v.id} className={"lw-card" + (open ? " lwa-open" : "")}>
        <div className="lw-rec-top lwa-cardtop">
          <span className="lw-card-h">{v.label}</span>
          <span className={"job-state " + (v.status === "approved" ? "job-ok" : v.status === "rejected" ? "job-bad" : "job-muted")}>{v.status}</span>
        </div>
        <div className="lw-meta">{v.hook.text}</div>
        <div className="lw-meta lw-muted">{v.durationSeconds}s · {v.wordCount} words · hook strength {pct(v.hook.strength)}</div>

        <div className="lwa-actions">
          <button className="lwa-btn" onClick={() => setOpenVersion(open ? null : v.id)}>{open ? "Hide script" : "View script"}</button>
          {v.status !== "approved" && <button className="lwa-btn" disabled={busy === `d:${v.id}`} onClick={() => decide(v.id, "approve")}>Approve</button>}
          {v.status !== "rejected" && <button className="lwa-btn" disabled={busy === `d:${v.id}`} onClick={() => decide(v.id, "reject")}>Reject</button>}
          <button className="lwa-btn" disabled={busy === `t:${v.id}` || v.status !== "approved"}
            title={v.status !== "approved" ? "Approve it first" : "Send to drafts"}
            onClick={() => toDraft(v.id)}>Send to drafts</button>
        </div>

        {open && (
          <div className="lwa-detail">
            <div className="lw-k">Why this hook</div>
            <p className="lw-hyp">{v.hook.rationale}</p>

            <div className="lw-k" style={{ marginTop: 12 }}>Script</div>
            <div className="ugc-scenes">
              {v.scenes.map((s) => (
                <div key={s.index} className="ugc-scene">
                  <span className="ugc-at">{s.at}s</span>
                  <div>
                    <div className="ugc-line">{s.line}</div>
                    <div className="lw-muted ugc-visual">{s.visual}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="lw-k" style={{ marginTop: 12 }}>Voice direction</div>
            <p className="lw-hyp">{v.voiceDirection}</p>

            <div className="lw-k" style={{ marginTop: 12 }}>Caption</div>
            {editing === v.id ? (
              <>
                <textarea className="mkt-input lwa-area" rows={4} value={captionDraft} onChange={(e) => setCaptionDraft(e.target.value)} />
                <div className="lwa-actions">
                  <button className="lwa-btn" disabled={busy === `e:${v.id}`} onClick={() => saveEdit(v.id)}>Save</button>
                  <button className="lwa-btn" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <pre className="cmp-body cmp-body-sm">{v.caption}</pre>
                <div className="lw-chips">{v.hashtags.map((h) => <span key={h} className="lw-chip">{h}</span>)}</div>
                <div className="lwa-actions">
                  <button className="lwa-btn" onClick={() => { setEditing(v.id); setCaptionDraft(v.caption); }}>Edit caption</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="st-section">
      <header className="st-shead">
        <span className="label">UGC</span>
        <h1>User-generated content</h1>
        <p>Hooks, scripts, creator and voice styles — several real versions to choose between, then straight into the same publishing pipeline as everything else.</p>
      </header>

      <div className="cmp-form">
        <div className="lwa-row">
          <input className="mkt-input" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product — e.g. Populr" aria-label="Product" />
          <input className="mkt-input" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Audience" aria-label="Audience" />
        </div>
        <div className="lwa-row">
          <input className="mkt-input" value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="The change it creates — e.g. a launch plan without a marketing hire" aria-label="Outcome" />
        </div>
        <div className="lwa-row">
          <input className="mkt-input" value={objection} onChange={(e) => setObjection(e.target.value)} placeholder="Objection to address (optional)" aria-label="Objection" />
        </div>
        <div className="cmp-controls">
          <select className="lwa-select" aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as UgcFormat)}>
            {UGC_FORMATS.map((f) => <option key={f} value={f}>{FORMAT_META[f].label}</option>)}
          </select>
          <select className="lwa-select" aria-label="Creator style" value={creatorStyle} onChange={(e) => setCreatorStyle(e.target.value as CreatorStyle)}>
            {CREATOR_STYLES.map((c) => <option key={c} value={c}>{CREATOR_STYLE_META[c].label}</option>)}
          </select>
          <select className="lwa-select" aria-label="Voice style" value={voiceStyle} onChange={(e) => setVoiceStyle(e.target.value as VoiceStyle)}>
            {VOICE_STYLES.map((v) => <option key={v} value={v}>{VOICE_STYLE_META[v].label}</option>)}
          </select>
          <select className="lwa-select" aria-label="Versions" value={versions} onChange={(e) => setVersions(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} version{n === 1 ? "" : "s"}</option>)}
          </select>
          <button className="st-card-cta st-card-gen" onClick={generate} disabled={busy === "gen"}>{busy === "gen" ? "Writing…" : "Generate scripts"}</button>
        </div>
        <p className="lw-muted cmp-hint">{FORMAT_META[format].blurb} · {CREATOR_STYLE_META[creatorStyle].stance}</p>
        {connected.length > 0
          ? <div className="lw-chips">{connected.map((p) => (
            <button key={p} type="button" className={"lw-chip lwa-chip-btn" + (platforms.includes(p) ? " on" : "")}
              onClick={() => setPlatforms((ps) => ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p])}>{p}</button>
          ))}</div>
          : <p className="lw-muted cmp-hint">No platforms connected — approved scripts still save as drafts, and will publish once you connect an account in Cross-Post.</p>}
      </div>

      {err && <div className="lw-card lwa-note lwa-sev-critical">{err}</div>}
      {note && <div className="lw-card lwa-note">{note}</div>}

      {pkg && meta && (
        <div className="cmp-meta">
          <span className="cmp-src">{meta.source === "llm" ? `${meta.provider}${meta.model ? ` · ${meta.model}` : ""}` : "built-in engine"}</span>
          <span className="cmp-conf">{Math.round(meta.confidence * 100)}% confident</span>
          <span className="cmp-reason">{meta.reasoning}</span>
          {meta.degradedReason && <span className="cmp-degraded">{meta.degradedReason}</span>}
        </div>
      )}

      {pkg && (
        <>
          <h3 className="lw-h2 cmp-h3">Hooks</h3>
          <div className="lw-cards">
            {pkg.hooks.map((h) => (
              <div key={h.id} className="lw-card">
                <div className="lw-rec-top lwa-cardtop">
                  <span className="lw-card-h">{h.text}</span>
                  <span className="lw-chip">{pct(h.strength)}</span>
                </div>
                <p className="lw-hyp">{h.rationale}</p>
              </div>
            ))}
          </div>

          <h3 className="lw-h2 cmp-h3">Versions</h3>
          <div className="lw-cards">{pkg.versions.map(renderVersion)}</div>
        </>
      )}

      {recent.length > 0 && (
        <>
          <h3 className="lw-h2 cmp-h3">Recent</h3>
          <div className="lw-cards">
            {recent.slice(0, 6).map((p) => (
              <div key={p.id} className="lw-card">
                <div className="lw-card-h">{p.brief.product}</div>
                <div className="lw-meta">{FORMAT_META[p.brief.format].label} · {p.versions.length} version(s) · {p.versions.filter((v) => v.status === "approved").length} approved</div>
                <div className="lwa-actions">
                  <button className="lwa-btn" onClick={() => { setPkg(p); setOpenVersion(p.versions[0]?.id ?? null); }}>Open</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
