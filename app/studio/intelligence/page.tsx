"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { workspaceId } from "@/lib/store";
import { REFERENCE_KINDS, type Reference, type ReferenceKind } from "@/lib/intelligence/types";

// The intelligence library, browsable.
//
// Every row shows where it came from and under what licence, because that is the honest
// answer to "where did this corpus come from" and it should be a column rather than a
// sentence in a launch post. A library that cannot say what it is allowed to hold is a
// liability the first time anyone asks.

const KIND_LABEL: Record<ReferenceKind, string> = {
  principle: "Principle",
  ad: "Ad",
  email: "Email",
  post: "Post",
  playbook: "Playbook",
  brand: "Brand",
};

const LICENCE_LABEL: Record<Reference["source"]["licence"], string> = {
  first_party: "Your data",
  public_api: "Public API",
  licensed: "Licensed",
  original: "Written by Populr",
};

type Payload = {
  ok: true;
  counts: { total: number; shared: number; own: number };
  references: Reference[];
};

export default function IntelligenceLibrary() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kind, setKind] = useState<ReferenceKind | "all">("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/intelligence?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
        .then((r) => r.json());
      if (!d?.ok) { setErr("The library could not be read just now."); return; }
      setData(d); setErr(null);
    } catch { setErr("The library could not be read just now."); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    return data.references.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (!needle) return true;
      return `${r.pattern} ${r.evidence} ${r.tags.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [data, kind, q]);

  if (err) return <div className="lw"><p className="conn-err" role="alert">{err}</p></div>;
  if (!data) return null;

  return (
    <div className="lw intel">
      <header className="intel-head">
        <h1 className="intel-h1">Marketing intelligence</h1>
        <p className="intel-sub">
          What Populr reads before it writes. Every entry names where it came from — the
          number that matters is how many apply to you, not how many exist.
        </p>
      </header>

      <div className="job-tiles">
        <div className="job-tile">
          <div className="job-tile-v">{data.counts.total}</div>
          <div className="job-tile-k">Available to you</div>
        </div>
        <div className="job-tile">
          <div className="job-tile-v">{data.counts.shared}</div>
          <div className="job-tile-k">Shared library</div>
        </div>
        <div className="job-tile">
          <div className="job-tile-v">{data.counts.own}</div>
          <div className="job-tile-k">From your own results</div>
        </div>
      </div>

      <div className="intel-filters">
        <input
          className="intel-search" type="search" value={q} placeholder="Search patterns…"
          onChange={(e) => setQ(e.target.value)} aria-label="Search the library"
        />
        <div className="intel-kinds">
          <button className={"conn-btn" + (kind === "all" ? " on" : "")} onClick={() => setKind("all")}>All</button>
          {REFERENCE_KINDS.map((k) => (
            <button key={k} className={"conn-btn" + (kind === k ? " on" : "")} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="intel-empty">
          {data.counts.total === 0
            // An empty corpus is a real state and says what fills it, rather than spinning.
            ? "The library is empty. It fills as Populr publishes for you and as sources are connected."
            : "Nothing matches that filter."}
        </p>
      ) : (
        <ul className="intel-list">
          {rows.map((r) => (
            <li key={r.id} className="intel-row">
              <div className="intel-row-top">
                <span className="intel-kind">{KIND_LABEL[r.kind]}</span>
                {r.channel && <span className="intel-chan">{r.channel}</span>}
                <span className="intel-lic">{LICENCE_LABEL[r.source.licence]}</span>
              </div>
              <p className="intel-pattern">{r.pattern}</p>
              <p className="intel-evidence">{r.evidence}</p>
              {r.metrics.length > 0 && (
                <ul className="intel-metrics">
                  {r.metrics.map((m) => (
                    <li key={m.label}>
                      <strong>{m.label}</strong> {m.value}
                      {m.baseline && <em> vs {m.baseline}</em>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="intel-row-foot">
                {/* Attribution is not optional furniture: a metric with no visible owner is
                    how another company's result becomes this customer's claim. */}
                <span className="intel-src">
                  {r.workspaceKey ? "Your workspace" : r.source.name}
                  {r.source.url && (
                    <>
                      {" · "}
                      <a href={r.source.url} target="_blank" rel="noopener noreferrer nofollow">source</a>
                    </>
                  )}
                </span>
                {r.tags.length > 0 && (
                  <span className="intel-tags">{r.tags.map((t) => <em key={t}>{t}</em>)}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
