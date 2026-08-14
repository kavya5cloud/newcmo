"use client";
import { useEffect, useState } from "react";
import Billing from "@/app/components/Billing";

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
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then(setMe).catch(() => setMe({ user: null, accountsEnabled: false }));
    fetch("/api/google/status").then((r) => r.json()).then(setGsc).catch(() => {});
    fetch("/api/state?wsid=account").then((r) => r.json()).then((d) => setSite(d.state || null)).catch(() => {});
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(tick);
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
  const liveTrial = me?.trial && Number.isFinite(Date.parse(me.trial.endsAt))
    ? {
        ...me.trial,
        daysLeft: Math.max(0, Math.ceil((Date.parse(me.trial.endsAt) - nowTick) / 86_400_000)),
        active: nowTick < Date.parse(me.trial.endsAt),
      }
    : me?.trial || null;

  return (
    <div className="appui">
      <div className="acct">
        <div className="acct-top">
          <a href="/app" className="acct-back">← back to app</a>
          <span className="app-wordmark">Populr.</span>
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

            {/* Plan.
                This block used to compute the trial itself and, once it ended, offer a
                mailto link saying card payments were not self-serve. Both are now false: the
                Billing panel reads the same access decision every gate enforces, and Polar
                takes the payment.

                It also had no way to subscribe while the trial was still running — someone
                who had decided had to wait to be locked out first. Subscribing early does
                not cost them the rest of the trial; accessFor lets an active subscription
                win without shortening anything. */}
            <div className="acct-card">
              <div className="acct-label">Plan</div>
              <Billing />
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
