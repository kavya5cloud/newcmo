"use client";
import { useEffect, useMemo, useState } from "react";

type App = {
  id: string;
  created_at: string;
  name: string;
  email: string;
  company: string | null;
  website: string | null;
  industry: string | null;
  marketing_challenge: string | null;
  status: string;
  notes: string | null;
};

const STATUSES = ["all", "new", "contacted", "accepted", "rejected"] as const;

function csv(rows: App[]): string {
  const cols = ["created_at", "name", "email", "company", "website", "industry", "marketing_challenge", "status", "notes"] as const;
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c as keyof App])).join(","))].join("\n");
}

export default function EarlyAccessAdmin() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>("all");

  function load() {
    fetch("/api/early-access/admin")
      .then((r) => { if (r.status === 403) { setForbidden(true); return null; } return r.json(); })
      .then((d) => { if (d?.applications) setApps(d.applications); })
      .catch(() => {});
  }
  useEffect(load, []);

  async function setStatus(id: string, status: string) {
    setApps((a) => a?.map((x) => (x.id === id ? { ...x, status } : x)) ?? null);
    await fetch("/api/early-access/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => {});
  }

  const filtered = useMemo(() => {
    if (!apps) return [];
    const needle = q.trim().toLowerCase();
    return apps.filter((a) => {
      if (filter !== "all" && a.status !== filter) return false;
      if (!needle) return true;
      return [a.name, a.email, a.company, a.industry, a.marketing_challenge]
        .some((v) => (v || "").toLowerCase().includes(needle));
    });
  }, [apps, q, filter]);

  function exportCsv() {
    const blob = new Blob([csv(filtered)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `early-access-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  if (forbidden) {
    return (
      <div className="eaa">
        <div className="eaa-gate">
          <h1>Admins only</h1>
          <p>Sign in with an admin account to view Early Access applications. Add your email to <code>ADMIN_EMAILS</code> to grant access.</p>
          <a href="/app" className="ea-btn ea-btn-sec">Open app →</a>
        </div>
      </div>
    );
  }

  return (
    <div className="eaa">
      <div className="eaa-top">
        <h1>Early Access <span>{apps ? `· ${apps.length}` : ""}</span></h1>
        <button className="eaa-export" onClick={exportCsv} disabled={!filtered.length}>Export CSV</button>
      </div>

      <div className="eaa-controls">
        <input className="eaa-search" placeholder="Search name, email, company, challenge…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="eaa-filters">
          {STATUSES.map((s) => (
            <button key={s} className={"eaa-fil" + (filter === s ? " on" : "")} onClick={() => setFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      {apps === null ? (
        <div className="eaa-empty">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="eaa-empty">No applications{q || filter !== "all" ? " match this filter" : " yet"}.</div>
      ) : (
        <div className="eaa-scroll">
          <table className="eaa-table">
            <thead>
              <tr><th>Date</th><th>Name</th><th>Email</th><th>Company</th><th>Industry</th><th>Challenge</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td className="eaa-mono">{new Date(a.created_at).toISOString().slice(0, 10)}</td>
                  <td>{a.name}</td>
                  <td className="eaa-mono"><a href={`mailto:${a.email}`}>{a.email}</a></td>
                  <td>{a.company || "—"}{a.website ? <><br /><a className="eaa-web" href={a.website.startsWith("http") ? a.website : `https://${a.website}`} target="_blank" rel="noopener noreferrer">{a.website}</a></> : null}</td>
                  <td>{a.industry || "—"}</td>
                  <td className="eaa-chal" title={a.marketing_challenge || ""}>{a.marketing_challenge || "—"}</td>
                  <td><span className="eaa-status" data-s={a.status}>{a.status}</span></td>
                  <td className="eaa-actions">
                    <button onClick={() => setStatus(a.id, "accepted")} disabled={a.status === "accepted"}>Accept</button>
                    <button onClick={() => setStatus(a.id, "rejected")} disabled={a.status === "rejected"}>Reject</button>
                    <button onClick={() => setStatus(a.id, "contacted")} disabled={a.status === "contacted"}>Contacted</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
