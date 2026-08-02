"use client";

import { useCallback, useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";
import { PLATFORM_CHOICES } from "@/lib/assistant/types";
import type { SocialPlatform } from "@/lib/social/types";

// Connecting your accounts, in the Agents column where the agents that use them live.
//
// One question is being answered per row: can Populr post here for me? Not "is a token
// stored", not "is an adapter registered" — those are true of things that still cannot
// publish, and a row that says Connected when nothing will go out is the single most
// expensive lie this screen could tell.
//
// So a row is Connected only when an account is linked AND that platform can actually
// reach the provider. Everything else is either an action or an honest "not yet".

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
export type RowState = "connected" | "linked_not_live" | "connect" | "soon";

export function stateOf(r: Row): RowState {
  const linked = r.account?.status === "connected";
  if (linked && r.live) return "connected";
  if (linked) return "linked_not_live";
  if (r.live) return "connect";
  return "soon";
}

const COPY: Record<RowState, { status: string; hint?: string }> = {
  connected: { status: "Connected" },
  // A token exists but nothing can go out. Saying "Connected" here would be the lie.
  linked_not_live: { status: "Linked", hint: "Publishing opens soon" },
  connect: { status: "" },
  soon: { status: "Soon" },
};

export default function Connections() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/social/accounts?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
        .then((r) => r.json());
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

  const connectedCount = rows.filter((r) => stateOf(r) === "connected").length;

  return (
    <div className="conn">
      <div className="conn-head">
        <span className="label">Accounts</span>
        <span className="conn-count">
          {connectedCount > 0 ? `${connectedCount} connected` : "None connected yet"}
        </span>
      </div>

      {err && <p className="conn-err" role="alert">{err}</p>}

      <div className="conn-list">
        {rows.map((r) => {
          const state = stateOf(r);
          const copy = COPY[state];
          return (
            <div className="conn-row" key={r.platform}>
              <span className="conn-name">{r.label}</span>

              {state === "connect" ? (
                <button className="conn-btn" disabled={busy === r.platform} onClick={() => connect(r.platform)}>
                  {busy === r.platform ? "…" : "Connect"}
                </button>
              ) : (
                <span className="conn-right">
                  <span className={"conn-status conn-" + state}>{copy.status}</span>
                  {state === "connected" && (
                    <button className="conn-x" title={`Disconnect ${r.label}`}
                      disabled={busy === r.account!.id} onClick={() => disconnect(r.account!.id)}>×</button>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Said once, at the bottom, rather than repeated on four rows. */}
      {rows.some((r) => stateOf(r) === "soon") && (
        <p className="conn-note">
          Populr already writes for the rest. Publishing to them opens in early access.
        </p>
      )}
    </div>
  );
}
