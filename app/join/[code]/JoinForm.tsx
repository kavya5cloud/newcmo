"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { workspaceId } from "@/lib/store";

// The sign-up form behind a referral link.
//
// Its own page rather than the modal buried in /app: someone arriving from a friend's link
// has already been persuaded, and making them find a "sign in" button first loses most of
// them. The code comes from the URL, so it cannot be lost between arriving and signing up.

const ERR: Record<string, string> = {
  email_taken: "That email is already registered — sign in instead.",
  invalid_email: "Enter a valid email address.",
  weak_password: "Use at least 8 characters.",
  no_database: "Accounts aren't set up yet.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
};

export default function JoinForm({ code }: { code: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The code travels with the request. Nothing depends on storage surviving the trip.
        body: JSON.stringify({ email, password: pw, ref: code, wsid: workspaceId() }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(ERR[d.error] || d.hint || "Something went wrong."); setBusy(false); return; }

      // Straight into setup — four questions, then their marketing is running.
      router.push("/app/assistant");
    } catch {
      setErr("Couldn't reach the server. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="join-form">
      <label htmlFor="join-email">Email</label>
      <input
        id="join-email" type="email" value={email} autoComplete="email" placeholder="you@company.com"
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />

      <label htmlFor="join-pw">Password</label>
      <input
        id="join-pw" type="password" value={pw} autoComplete="new-password" placeholder="at least 8 characters"
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />

      {err && <div className="autherr" role="alert">{err}</div>}

      <button className="join-submit" onClick={submit} disabled={busy || !email || pw.length < 8}>
        {busy ? "Creating…" : "Create my account"}
      </button>

      <p className="join-alt">
        Already have an account? <a href="/app">Sign in</a>
      </p>
    </div>
  );
}
