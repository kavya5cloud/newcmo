"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";

// Subscribing, and managing it afterwards.
//
// Two things this deliberately does not do:
//
//   It never decides access itself. The server says allowed/reason/message; this renders it.
//   A client that computes "your trial has 3 days left" from a date will eventually disagree
//   with the server that actually enforces the gate, and the visible one will be wrong.
//
//   Subscribing is offered during the trial, not only after it ends. Someone who has decided
//   should not have to wait to be locked out before they can pay, and an account that
//   subscribes on day three keeps the rest of its trial — see accessFor, where an active
//   subscription wins over the trial without shortening it.
//
//   It does not assume a return from checkout means a live subscription. Polar's webhook
//   arrives on its own schedule, usually seconds later but not always, so coming back with
//   ?subscribed=1 starts a short poll rather than declaring success. Telling someone they are
//   subscribed and then locking them out a moment later is worse than a five-second wait.

type Status = {
  allowed: boolean;
  reason: string;
  until: number | null;
  message: string;
  canSubscribe: boolean;
  subscribed: boolean;
  /** Subscribed through Polar, so the hosted portal can actually open. */
  manageable: boolean;
  status: string | null;
  daysLeft: number | null;
};

/**
 * What a bounced-back checkout or portal means, in words.
 *
 * These routes redirect here with ?billing=<reason> rather than answering with JSON, because
 * a navigation that receives JSON shows no error at all — the browser downloads a file and
 * leaves the page where it was. Which is exactly what happened: Subscribe was clicked, a
 * file named "checkout" appeared in Downloads, and nothing on screen changed.
 */
const BILLING_ERROR: Record<string, string> = {
  not_configured: "Subscriptions aren't switched on yet. Nothing was charged.",
  rate_limited: "Too many attempts in a row. Wait a minute and try again.",
  checkout_failed: "We couldn't open checkout. Nothing was charged — try again shortly.",
  portal_unavailable: "The billing portal isn't available for this account yet.",
};

const POLL_MS = 2000;
const POLL_ATTEMPTS = 8;   // ~16s, past which a webhook is late rather than in flight

export default function Billing() {
  const [s, setS] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"checkout" | "portal" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  const load = useCallback(async (): Promise<Status | null> => {
    try {
      const r = await fetch("/api/billing", { cache: "no-store" });
      const d = await r.json();
      if (d?.ok) { setS(d); return d; }
    } catch {
      // A missing panel beats a broken one — billing is not why they opened Settings.
    }
    return null;
  }, []);

  useEffect(() => { void load(); }, [load]);

  // A failed checkout or portal sends us back with a reason. Read it, say it, then clear it
  // so a refresh does not show a stale complaint.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reason = new URLSearchParams(window.location.search).get("billing");
    if (!reason) return;
    setErr(BILLING_ERROR[reason] ?? "Something went wrong with billing. Try again shortly.");
    const url = new URL(window.location.href);
    url.searchParams.delete("billing");
    window.history.replaceState({}, "", url.toString());
  }, []);

  // Returning from a successful checkout: wait for the webhook rather than trusting the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("subscribed")) return;

    setWaiting(true);
    let attempts = 0;
    const id = setInterval(async () => {
      attempts++;
      const d = await load();
      if (d?.subscribed || attempts >= POLL_ATTEMPTS) {
        clearInterval(id);
        setWaiting(false);
        // Clear the flag so a refresh does not start polling again.
        const url = new URL(window.location.href);
        url.searchParams.delete("subscribed");
        window.history.replaceState({}, "", url.toString());
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // Both are plain navigations into server routes that redirect on to Polar. No fetch, no
  // URL handed to the browser to act on — the identity of the customer is decided on the
  // server and never travels through the client.
  const go = useCallback((action: "checkout" | "portal") => {
    setBusy(action); setErr(null);
    window.location.href = `/api/billing/${action}`;
  }, []);

  if (!s) return null;

  const until = s.until ? new Date(s.until).toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : null;

  return (
    <div className="bill">
      <p className="bill-state">
        <Icon name={s.allowed ? "check-circle" : "clock"} size={14} />
        <span>{s.message}</span>
      </p>

      {until && s.allowed && (
        <p className="bill-until">
          {s.reason === "trial" ? "Trial ends" : s.reason === "grace" ? "Access pauses" : "Renews"} {until}
          {s.daysLeft != null && ` · ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`}
        </p>
      )}

      {waiting && <p className="bill-until">Confirming your payment…</p>}

      {err && <p className="bill-err">{err}</p>}

      <div className="bill-acts">
        {s.manageable ? (
          <button className="bill-btn" onClick={() => go("portal")} disabled={busy !== null}>
            {busy === "portal" ? <span className="btn-spin" aria-label="Opening" /> : "Manage billing"}
          </button>
        ) : s.canSubscribe ? (
          <button className="bill-btn bill-pri" onClick={() => go("checkout")} disabled={busy !== null}>
            {busy === "checkout" ? <span className="btn-spin" aria-label="Starting" /> : "Subscribe — $15/month"}
          </button>
        ) : (
          // Billing is not switched on. Say so rather than showing a button that fails after
          // the click.
          <p className="bill-until">Subscriptions aren&apos;t open yet.</p>
        )}
      </div>
    </div>
  );
}
