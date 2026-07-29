"use client";

import { useCallback, useEffect, useState } from "react";
import { humanError, humanThrow } from "@/lib/ui/errors";
import { loadState } from "@/lib/store";
import {
  CREATOR_STYLE_META, FORMAT_META, UGC_FORMATS, VOICE_STYLE_META,
  type UgcPackage, type UgcVersion,
} from "@/lib/ugc/types";

// The UGC review feed: read what was written, edit it, approve or reject it, download it.
//
// This page used to be a mock — invented testimonials, fabricated engagement numbers and
// stock photographs hotlinked from Unsplash, presented as a client's content. Every field
// is now something that actually exists.
//
// Two things were dropped rather than faked. There are no generated images yet, so there
// is no image: a stock photo standing in for a customer's asset is exactly what gets
// noticed in a demo. And "Why this hook?" shows the hook's real rationale from the UGC
// engine instead of a sentence written to sound like analysis.

type Row = { pkg: UgcPackage; version: UgcVersion };

const pct = (n: number) => `${Math.round(n * 100)}%`;
const dayKey = () => new Date().toISOString().slice(0, 10);

/** Rotate the format daily so a batch generated today differs from yesterday's. */
function formatForToday() {
  const days = Math.floor(Date.now() / 86_400_000);
  return UGC_FORMATS[days % UGC_FORMATS.length];
}

export default function BlitzPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [why, setWhy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ name: string; audience: string; outcome: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch("/api/ugc").then((r) => r.json());
      if (!d?.ok) { setErr(humanError(d)); return; }
      // Anything still awaiting a decision, newest first.
      const list: Row[] = (d.packages as UgcPackage[])
        .flatMap((pkg) => pkg.versions.filter((v) => v.status === "draft").map((version) => ({ pkg, version })))
        .sort((a, b) => b.pkg.updatedAt - a.pkg.updatedAt);
      setRows(list);
      setErr(null);
    } catch (e) { setErr(humanThrow(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    // The business this writes about, so a generated batch is about the real product.
    // loadState() is the shared reader: it passes the workspace id and falls back to
    // localStorage when Neon isn't configured. A bare fetch("/api/state") would read the
    // wrong workspace and find nothing for anyone whose profile never reached the cloud.
    loadState().then(({ saved }) => {
      const p = saved?.profile;
      if (p?.name) setProfile({ name: p.name, audience: p.audience || "founders", outcome: p.oneLiner || p.positioning || "" });
    }).catch(() => {});
  }, [load]);

  const act = useCallback(async (body: Record<string, unknown>, tag: string) => {
    setBusy(tag); setErr(null); setNote(null);
    try {
      const r = await fetch("/api/ugc", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(humanError(d, r.status)); return null; }
      return d;
    } catch (e) { setErr(humanThrow(e)); return null; }
    finally { setBusy(null); }
  }, []);

  /**
   * Today's batch. The format rotates by date and the id is derived from the brief, so
   * running this twice in a day is the same package rather than a duplicate pile.
   */
  const generateToday = useCallback(async () => {
    if (!profile) { setErr("Paste your website in the app first — otherwise this writes about nothing."); return; }
    const d = await act({
      op: "generate",
      product: profile.name,
      audience: profile.audience,
      outcome: profile.outcome || `what ${profile.name} changes for ${profile.audience}`,
      format: formatForToday(),
      creatorStyle: "founder",
      voiceStyle: "conversational",
      versions: 3,
    }, "gen");
    if (!d?.ok) return;
    setNote(`Today's batch is ready — ${FORMAT_META[formatForToday()].label.toLowerCase()}, ${d.package.versions.length} versions.`);
    load();
  }, [act, profile, load]);

  /**
   * Keep the feed fresh without being asked.
   *
   * If nothing is waiting and today's batch hasn't been written yet, write it once. The
   * marker is per day, so coming back later the same day doesn't stack up duplicates —
   * and the package id is derived from the brief anyway, so a repeat run returns the same
   * package rather than a second one.
   *
   * Deliberately client-side: Vercel's Hobby plan is already at its two-cron ceiling, so a
   * scheduled job would have cost us the publishing crons. This runs when someone actually
   * looks at the page, which is when fresh content is worth anything.
   */
  useEffect(() => {
    if (loading || rows.length > 0 || !profile || busy) return;
    const marker = `populr:blitz:${dayKey()}`;
    try {
      if (localStorage.getItem(marker)) return;
      localStorage.setItem(marker, "1");
    } catch { return; }   // private mode — the button above still works
    generateToday();
  }, [loading, rows.length, profile, busy, generateToday]);

  const decide = useCallback(async (row: Row, op: "approve" | "reject") => {
    const d = await act({ op, id: row.pkg.id, versionId: row.version.id }, `d:${row.version.id}`);
    if (!d?.ok) return;
    setRows((all) => all.filter((r) => r.version.id !== row.version.id));
    setNote(op === "approve"
      ? "Approved. Send it to drafts from the UGC workspace to schedule it."
      : "Rejected. It stays in the package, marked rejected.");
  }, [act]);

  const saveEdit = useCallback(async (row: Row) => {
    const caption = drafts[row.version.id];
    if (caption == null) { setEditing(null); return; }
    const d = await act({ op: "edit", id: row.pkg.id, versionId: row.version.id, caption }, `e:${row.version.id}`);
    if (!d?.ok) return;
    setRows((all) => all.map((r) => (r.version.id === row.version.id ? { ...r, version: { ...r.version, caption } } : r)));
    setEditing(null);
    setNote("Saved.");
  }, [act, drafts]);

  /** Download the script — the thing that exists — rather than a picture of one. */
  const download = useCallback((row: Row) => {
    const { version, pkg } = row;
    const text = [
      `${pkg.brief.product} — ${version.label}`,
      `${FORMAT_META[pkg.brief.format].label} · ${version.durationSeconds}s · ${version.wordCount} words`,
      ``, `HOOK`, version.hook.text, `(${version.hook.rationale})`,
      ``, `SCRIPT`,
      ...version.scenes.map((s) => `${s.at}s  ${s.line}\n     [${s.visual}]`),
      ``, `VOICE`, version.voiceDirection,
      ``, `CAPTION`, version.caption, version.hashtags.join(" "),
    ].join("\n");

    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${pkg.brief.product}-${version.label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, []);

  return (
    <div className="blitz-page">
      <main className="blitz-workspace">
        <div className="blitz-top">
          <div>
            <span className="blitz-eyebrow">UGC review · {dayKey()}</span>
            <h1>Read it, edit it, decide.</h1>
            <p>Everything written for a creator to film, waiting on you. Approved scripts go to drafts and publish like any other post.</p>
          </div>
          <button className="cmp-go" disabled={busy === "gen"} onClick={generateToday}>
            {busy === "gen" ? "Writing…" : "Generate today's batch"}
          </button>
        </div>

        <div className="blitz-toolbar">
          <div className="blitz-tabs">
            <button className="on">Awaiting review</button>
            <button className={why ? "on" : ""} aria-pressed={why} onClick={() => setWhy((v) => !v)}>Why this hook?</button>
          </div>
          <span>{loading ? "Loading…" : `${rows.length} awaiting review`}</span>
        </div>

        {err && <div className="cmp-err" role="alert">{err}</div>}
        {note && <div className="cmp-note-line">{note}</div>}

        {loading && <div className="blitz-empty"><span>Loading your UGC…</span></div>}

        {!loading && rows.length === 0 && (
          <div className="blitz-empty">
            <strong>Nothing waiting on you.</strong>
            <span>
              Today&apos;s format is {FORMAT_META[formatForToday()].label.toLowerCase()} — {FORMAT_META[formatForToday()].blurb}
            </span>
            <button className="cmp-go" style={{ marginTop: 12 }} disabled={busy === "gen"} onClick={generateToday}>
              {busy === "gen" ? "Writing…" : "Generate today's batch"}
            </button>
          </div>
        )}

        <section className="blitz-feed" aria-label="UGC awaiting review">
          {rows.map((row) => {
            const { pkg, version } = row;
            const isEditing = editing === version.id;
            const caption = drafts[version.id] ?? version.caption;
            return (
              <article className="blitz-feed-item" key={version.id}>
                <div className="blitz-feed-copy">
                  <div className="blitz-card-head">
                    <span>{pkg.brief.product}</span>
                    <small>{FORMAT_META[pkg.brief.format].label}</small>
                  </div>

                  {/* The script itself, which is what there is to look at. */}
                  <div className="blitz-script">
                    {version.scenes.map((s) => (
                      <div key={s.index} className="ugc-scene">
                        <span className="ugc-at">{s.at}s</span>
                        <div>
                          <div className="ugc-line">{s.line}</div>
                          <div className="lw-muted ugc-visual">{s.visual}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="blitz-card-foot">
                    <span>{CREATOR_STYLE_META[version.creatorStyle].label} · {VOICE_STYLE_META[version.voiceStyle].label}</span>
                    <span>{version.durationSeconds}s · {version.wordCount} words</span>
                  </div>
                </div>

                <div className="blitz-feed-detail">
                  <div className="blitz-feed-label">Awaiting review</div>
                  <h2>{version.label}</h2>
                  <p className="blitz-feed-description">{version.hook.text}</p>

                  <div className="blitz-feed-meta">
                    <span>Hook strength {pct(version.hook.strength)}</span>
                    <span>{pkg.brief.audience}</span>
                  </div>

                  {why && (
                    <div className="blitz-why">
                      <strong>Why this hook?</strong>
                      <span>{version.hook.rationale}</span>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="blitz-editor">
                      <label htmlFor={`blitz-edit-${version.id}`}>Caption</label>
                      <textarea
                        id={`blitz-edit-${version.id}`} value={caption}
                        onChange={(e) => setDrafts((all) => ({ ...all, [version.id]: e.target.value }))}
                      />
                      <button disabled={busy === `e:${version.id}`} onClick={() => saveEdit(row)}>
                        {busy === `e:${version.id}` ? "Saving…" : "Save"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <pre className="cmp-body cmp-body-sm">{version.caption}</pre>
                      <div className="lw-chips">{version.hashtags.map((h) => <span key={h} className="lw-chip">{h}</span>)}</div>
                    </>
                  )}

                  <div className="blitz-feed-actions">
                    <button className="blitz-download" onClick={() => download(row)}>Download script</button>
                    <button className="blitz-feed-edit" onClick={() => {
                      setEditing(isEditing ? null : version.id);
                      setDrafts((all) => ({ ...all, [version.id]: version.caption }));
                    }}>{isEditing ? "Close" : "Edit"}</button>
                    <button className="blitz-feed-reject" disabled={busy === `d:${version.id}`} onClick={() => decide(row, "reject")}>Reject</button>
                    <button className="blitz-feed-approve" disabled={busy === `d:${version.id}`} onClick={() => decide(row, "approve")}>Approve</button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
