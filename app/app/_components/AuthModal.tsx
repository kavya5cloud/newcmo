"use client";

import { useEffect, useState } from "react";
import { clearReferral, readReferral } from "@/lib/referral-client";
import Icon from "@/app/components/Icon";

/* ---------- auth modal ---------- */
export const AUTH_ERR: Record<string, string> = {
  email_taken: "That email is already registered — try signing in.",
  invalid_credentials: "Wrong email or password.",
  invalid_email: "Enter a valid email address.",
  weak_password: "Use at least 8 characters.",
  no_database: "Accounts aren't set up yet (no database connected).",
};

export function AuthModal({ onClose, forced }: { onClose: () => void; forced?: boolean }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<{ google: boolean; facebook: boolean; x: boolean }>({ google: false, facebook: false, x: false });

  useEffect(() => {
    fetch("/api/auth/providers").then((r) => r.json()).then(setProviders).catch(() => {});
  }, []);
  const anySocial = providers.google || providers.facebook || providers.x;

  async function submit() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A referral code arrives in the URL and has to survive until the account exists —
        // which may be several screens later — so it is parked in storage on arrival.
        body: JSON.stringify({ email, password: pw, ref: mode === "signup" ? readReferral() : undefined }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(AUTH_ERR[d.error] || d.hint || "Something went wrong."); setBusy(false); return; }
      // On signup, carry the anonymous workspace over so the just-analyzed site isn't lost.
      if (mode === "signup") {
        clearReferral();
        try {
          const local = localStorage.getItem("cosmos.state");
          if (local && JSON.parse(local)?.profile) {
            await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wsid: "migrate", state: JSON.parse(local) }) });
          }
        } catch { /* best-effort */ }
      }
      try { localStorage.removeItem("cosmos.nudgeDismissed"); } catch {}
      location.reload();
    } catch {
      setErr("Network error — try again."); setBusy(false);
    }
  }

  return (
    <div className="authwrap" onClick={(e) => { if (e.target === e.currentTarget && !forced) onClose(); }}>
      <div className="authcard">
        {!forced && <button className="xclose" aria-label="Close" onClick={onClose}><Icon name="close" size={15} /></button>}
        <h3>{mode === "signup" ? "Create your account" : "Welcome back"}</h3>
        <div className="authsub">{mode === "signup" ? "Save your workspace across devices." : "Sign in to your Populr workspace."}</div>
        {anySocial && (
          <div className="social">
            {providers.google && (
              <a className="social-btn" href="/api/auth/google">
                <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" /><path fill="#EA4335" d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.5 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 6.68 9.14 4.75 12 4.75z" /></svg>
                Continue with Google
              </a>
            )}
            {providers.facebook && (
              <a className="social-btn" href="/api/auth/facebook">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="#1877F2" aria-hidden="true"><path d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12z" /></svg>
                Continue with Facebook
              </a>
            )}
            {providers.x && (
              <a className="social-btn" href="/api/auth/x">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M17.2 3h3l-6.6 7.6L21.5 21h-6.1l-4.8-6.2L5.1 21h-3l7.1-8.1L2.5 3h6.2l4.3 5.7L17.2 3z" /></svg>
                Continue with X
              </a>
            )}
            <div className="social-or"><span>or</span></div>
          </div>
        )}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="you@company.com" autoComplete="email" />
        <label>Password</label>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder={mode === "signup" ? "at least 8 characters" : "••••••••"} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        {err && <div className="autherr">{err}</div>}
        <button className="submit" onClick={submit} disabled={busy}>{busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}</button>
        <div className="toggle">
          {mode === "signup" ? "Already have an account? " : "New here? "}
          <button onClick={() => { setMode(mode === "signup" ? "login" : "signup"); setErr(""); }}>
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}
