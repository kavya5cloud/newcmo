"use client";

import { useCallback, useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";
import { PLATFORM_CHOICES } from "@/lib/assistant/types";
import type { SocialPlatform } from "@/lib/social/types";

// Connecting your accounts. The only implementation of this in the product.
//
// There used to be three: this one, the publishing page, and the connector cockpit. Two of
// them posted to the reference endpoint, which fabricates a connection — a Connect button
// that turns green and links nothing. One place, one real OAuth flow.
//
// One question is answered per row: can Populr post here for me? Not "is a token stored",
// not "is an adapter registered" — both are true of things that still cannot publish, and a
// row claiming Connected when nothing will go out is the most expensive lie here.
//
// So Connected requires an account AND a platform that can reach the provider. Everything
// else is either an action or an honest "not yet".
//
// Two shapes, same logic: `compact` for the dashboard column, `full` for Settings.

type Account = { id: string; platform: SocialPlatform; handle: string; status: string };
type PlatformInfo = { platform: SocialPlatform; live: boolean };

export type Row = {
  platform: SocialPlatform;
  label: string;
  account: Account | null;
  /** The platform can reach the real provider right now. */
  live: boolean;
  earlyAccess: boolean;
};

/** What this row can do, in the user's terms. */
export type RowState = "connected" | "paused" | "linked_not_live" | "connect" | "needs_plan" | "soon";

/**
 * @param hasPlan Whether the account may publish at all — trial or subscription. Defaults
 *   true so a signed-out visitor, who has no plan to be lapsed, still sees Connect rather
 *   than being asked to subscribe before being asked to sign in.
 */
export function stateOf(r: Row, hasPlan = true): RowState {
  const linked = r.account?.status === "connected";
  // Publishing is gated on the plan server-side, so a lapsed account with a perfectly good
  // token still cannot post. Leaving this row on "Connected" would put back the exact lie
  // this component exists to prevent — the connection is real, the publishing is not.
  if (linked && r.live) return hasPlan ? "connected" : "paused";
  if (linked) return "linked_not_live";
  if (r.live) return hasPlan ? "connect" : "needs_plan";
  return "soon";
}

const COPY: Record<RowState, { status: string; hint?: string }> = {
  connected: { status: "Connected" },
  // The account is fine; the plan is not. Said as "Paused" rather than "Expired" because
  // nothing was lost — the token is still here and posting resumes on payment.
  paused: { status: "Paused", hint: "Subscribe to resume" },
  // A token exists but nothing can go out. Saying "Connected" here would be the lie.
  linked_not_live: { status: "Linked", hint: "Publishing opens soon" },
  connect: { status: "" },
  // Built, working, and behind the plan — unlike `soon`, which is not built at all. Two
  // different sentences on purpose: this one is a thing you can buy today.
  needs_plan: { status: "Pro", hint: "Subscribe to connect" },
  // "Coming to Pro", not "Available in Pro".
  //
  // These four have no adapter at all — createLiveAdapters() returns LinkedIn and X and
  // nothing else — and Instagram and Facebook additionally need Meta's approval, which is
  // still pending. "Available in Pro" tells someone that buying Pro gets them Instagram
  // publishing. They would pay and find nothing works, which is a refund and a review.
  //
  // One word apart, and it is the difference between a roadmap note and a false claim.
  soon: { status: "Soon", hint: "Coming to Pro" },
};

export default function AccountConnections({ variant = "compact" }: { variant?: "compact" | "full" } = {}) {
  const full = variant === "full";
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Trial or subscription — the same question the routes ask, asked once for the whole list.
  // Starts true so the rows never flash "Subscribe" at a paying customer while /me is in
  // flight; the only thing a wrong optimistic value costs is one refused click.
  const [hasPlan, setHasPlan] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, me] = await Promise.all([
        fetch(`/api/social/accounts?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
          .then((r) => r.json()),
        // Best effort. If this fails we assume the plan is fine and let the server refuse —
        // locking someone out of their own accounts because /me timed out is the worse bug.
        fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      // Signed out is not lapsed. Those rows want "Connect" (which prompts a sign-in), not
      // a subscription pitch aimed at someone with no account yet.
      setHasPlan(!me?.user || me?.access?.allowed !== false);
      if (!d?.ok) { setErr("Couldn't load your accounts."); return; }

      const live = new Map<SocialPlatform, boolean>(
        (d.platforms as PlatformInfo[]).map((p) => [p.platform, p.live]),
      );
      // Newest connection wins if a platform somehow has more than one.
      const byPlatform = new Map<SocialPlatform, Account>();
      for (const a of d.accounts as Account[]) byPlatform.set(a.platform, a);

      setRows(PLATFORM_CHOICES.map((p) => ({
        platform: p.platform,
        label: p.label,
        account: byPlatform.get(p.platform) ?? null,
        live: live.get(p.platform) ?? false,
        earlyAccess: p.readiness === "early_access",
      })));
      setErr(null);
    } catch { setErr("Couldn't load your accounts."); }
  }, []);

  useEffect(() => { load(); }, [load]);

  /**
   * Connecting is a full-page trip to the provider and back — OAuth cannot happen in a
   * fetch. The route answers 503 if Populr's own credentials are missing, so this checks
   * first rather than dropping someone onto a page of raw JSON.
   */
  const connect = useCallback(async (platform: SocialPlatform) => {
    setBusy(platform); setErr(null);
    try {
      const probe = await fetch(`/api/social/oauth/${platform}/start`, { redirect: "manual" });
      if (probe.type === "opaqueredirect" || probe.status === 0 || probe.ok) {
        window.location.href = `/api/social/oauth/${platform}/start`;
        return;
      }
      const d = await probe.json().catch(() => ({}));
      // 402 is the plan gate. It carries its own sentence — "your free month has ended",
      // "your last payment failed" — and those are different problems with different fixes,
      // so use what the server said rather than flattening both into one generic line.
      if (probe.status === 402) {
        setHasPlan(false);
        setErr(d?.hint || "Publishing is part of the plan. Subscribe to connect an account.");
        return;
      }
      setErr(d?.error === "sign_in_required"
        ? "Sign in first, then connect your account."
        : "That connection isn't available yet. Nothing is wrong on your side.");
    } catch { setErr("Couldn't start the connection. Try again in a moment."); }
    finally { setBusy(null); }
  }, []);

  const disconnect = useCallback(async (accountId: string) => {
    setBusy(accountId); setErr(null);
    try {
      await fetch("/api/social/accounts/disconnect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      load();
    } catch { setErr("Couldn't disconnect. Try again."); }
    finally { setBusy(null); }
  }, [load]);

  if (!rows) return null;

  const connectedCount = rows.filter((r) => stateOf(r, hasPlan) === "connected").length;

  return (
    <div className={"conn" + (full ? " conn-full" : "")}>
      {!full && (
        <div className="conn-head">
          <span className="label">Accounts</span>
          <span className="conn-count">
            {connectedCount > 0 ? `${connectedCount} connected` : "None connected yet"}
          </span>
        </div>
      )}

      {err && <p className="conn-err" role="alert">{err}</p>}

      <div className="conn-list">
        {rows.map((r) => {
          const state = stateOf(r, hasPlan);
          const copy = COPY[state];
          // Paused is still a live connection, so it keeps the handle and the ability to
          // disconnect. Losing the plan should never look like losing the account.
          const linked = state === "connected" || state === "paused";
          // Settings shows a Subscribe button, which says the same thing as the hint and
          // says it as something you can press. Two of them crowd the row off the screen on
          // a phone. The dashboard has no button, so there the hint is the whole message.
          const canBuy = state === "needs_plan" || state === "paused";
          const hint = canBuy && full ? undefined : copy.hint;
          return (
            <div className="conn-row" key={r.platform}>
              <span className="conn-name">
                {r.label}
                {full && linked && <em className="conn-handle">{r.account!.handle}</em>}
                {full && state === "soon" && <em className="conn-handle">Populr writes for it now</em>}
              </span>

              {state === "connect" ? (
                <button className="conn-btn" disabled={busy === r.platform} onClick={() => connect(r.platform)}>
                  {busy === r.platform ? "…" : "Connect"}
                </button>
              ) : (
                <span className="conn-right">
                  <span className="conn-stat">
                    <span className={"conn-status conn-" + state}>{copy.status}</span>
                    {hint && <em className="conn-hint">{hint}</em>}
                  </span>
                  {/* A link, not a fetch: /api/billing/checkout reads the session, builds the
                      checkout server-side and redirects on to Polar. */}
                  {canBuy && full && (
                    <a className="conn-btn" href="/api/billing/checkout">Subscribe</a>
                  )}
                  {linked && (
                    <button className={full ? "conn-btn" : "conn-x"} title={`Disconnect ${r.label}`}
                      disabled={busy === r.account!.id} onClick={() => disconnect(r.account!.id)}>
                      {full ? "Disconnect" : "×"}
                    </button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Said once, at the bottom, rather than repeated on six rows.
          Two separate facts, and collapsing them would misinform in one direction or the
          other: publishing anywhere is paid, and four of these cannot be published to at
          any price yet. */}
      {full && (
        <p className="conn-note">
          Publishing and scheduling are part of the $15/mo plan, and free for your first
          month. Populr writes your posts either way.
        </p>
      )}
      {rows.some((r) => stateOf(r, hasPlan) === "soon") && (
        <p className="conn-note">
          Populr already writes for these. Publishing to them is coming to Pro — it needs
          approval from each platform first, and none of it is live yet.
        </p>
      )}
    </div>
  );
}
