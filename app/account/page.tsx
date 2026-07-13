"use client";
import { useEffect, useState } from "react";

type Me = {
  user: { email: string } | null;
  accountsEnabled: boolean;
  createdAt?: string | null;
  trial?: { endsAt: string; daysLeft: number; active: boolean } | null;
};

type Site = { url?: string; profile?: { name?: string } | null } | null;

export default function Account() {
  const [me, setMe] = useState<Me | null>(null);
  const [gsc, setGsc] = useState<{ configured: boolean; connected: boolean; sites: string[] }>({ configured: false, connected: false, sites: [] });
  const [site, setSite] = useState<Site>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then(setMe).catch(() => setMe({ user: null, accountsEnabled: false }));
    fetch("/api/google/status").then((r) => r.json()).then(setGsc).catch(() => {});
    fetch("/api/state?wsid=account").then((r) => r.json()).then((d) => setSite(d.state || null)).catch(() => {});
  }, []);

  async function changeWebsite() {
    if (!confirm("Remove the current website and analyze a different one? This clears its analysis, drafts, and chat.")) return;
    setBusy(true);
    await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wsid: "account", state: { url: "", profile: null, competitors: [], chat: [], drafts: [], feed: {}, rankings: [], docs: {} } }),
    }).catch(() => {});
    try { localStorage.removeItem("cosmos.state"); } catch {}
    window.location.href = "/app";
  }

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/app";
  }
  async function disconnectGoogle() {
    setBusy(true);
    await fetch("/api/google/disconnect", { method: "POST" }).catch(() => {});
    setGsc((g) => ({ ...g, connected: false, sites: [] }));
    setBusy(false);
  }

  const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—");

  return (
    <div className="appui">
      <div className="acct">
        <div className="acct-top">
          <a href="/app" className="acct-back">← back to app</a>
          <img src="/logo.png" alt="cosmos.ai" style={{ height: 14, imageRendering: "pixelated" }} />
        </div>

        {me && !me.user && (
          <div className="acct-card" style={{ textAlign: "center" }}>
            <h2>You&apos;re not signed in</h2>
            <p className="acct-dim">Sign in from the app to see your account.</p>
            <a href="/app" className="acct-btn pri" style={{ marginTop: 16, display: "inline-block" }}>Go to app</a>
          </div>
        )}

        {me?.user && (
          <>
            <h1 className="acct-h1">Account</h1>

            <div className="acct-card">
              <div className="acct-row"><span className="acct-k">Email</span><span className="acct-v">{me.user.email}</span></div>
              <div className="acct-row"><span className="acct-k">Member since</span><span className="acct-v">{fmtDate(me.createdAt)}</span></div>
            </div>

            <div className="acct-card">
              <div className="acct-label">Plan</div>
              {me.trial ? (
                me.trial.active ? (
                  <>
                    <div className="acct-plan">Free trial <span className="acct-badge ok">active</span></div>
                    <p className="acct-dim">{me.trial.daysLeft} day{me.trial.daysLeft === 1 ? "" : "s"} left — ends {fmtDate(me.trial.endsAt)}. Then $49/mo.</p>
                    <div className="acct-meter"><i style={{ width: `${Math.min(100, (me.trial.daysLeft / 30) * 100)}%` }} /></div>
                  </>
                ) : (
                  <>
                    <div className="acct-plan">Free trial <span className="acct-badge end">ended</span></div>
                    <p className="acct-dim">Your free month ended {fmtDate(me.trial.endsAt)}. Upgrade to keep using cosmos.</p>
                    <button className="acct-btn pri" style={{ marginTop: 12 }} disabled title="Billing coming soon">Upgrade — $49/mo</button>
                  </>
                )
              ) : (
                <p className="acct-dim">Free</p>
              )}
            </div>

            <div className="acct-card">
              <div className="acct-label">Website</div>
              {site?.profile?.name || site?.url ? (
                <>
                  <div className="acct-row"><span className="acct-k">Analyzing</span><span className="acct-v">{site.profile?.name || site.url}</span></div>
                  {site.url && <p className="acct-dim" style={{ marginTop: 8, wordBreak: "break-all" }}>{site.url}</p>}
                  <button className="acct-btn" style={{ marginTop: 12 }} onClick={changeWebsite} disabled={busy}>Change website</button>
                </>
              ) : (
                <>
                  <p className="acct-dim">No website analyzed yet.</p>
                  <a className="acct-btn" href="/app" style={{ marginTop: 12 }}>Analyze a website</a>
                </>
              )}
            </div>

            <div className="acct-card">
              <div className="acct-label">Integrations</div>
              <div className="acct-row">
                <span className="acct-k">Google Search Console</span>
                {!gsc.configured ? (
                  <span className="acct-v acct-dim">not configured</span>
                ) : gsc.connected ? (
                  <button className="acct-btn" onClick={disconnectGoogle} disabled={busy}>Disconnect</button>
                ) : (
                  <a className="acct-btn" href="/api/google/connect">Connect</a>
                )}
              </div>
              {gsc.connected && gsc.sites[0] && <p className="acct-dim" style={{ marginTop: 8 }}>Site: {gsc.sites[0].replace(/^sc-domain:/, "").replace(/^https?:\/\//, "")}</p>}
            </div>

            <div className="acct-card">
              <div className="acct-label">Session</div>
              <button className="acct-btn" onClick={logout} disabled={busy}>Log out</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
