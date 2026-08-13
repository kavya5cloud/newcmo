"use client";

import { useState } from "react";
import AccountConnections from "@/app/components/AccountConnections";
import ConnectorCockpit from "./ConnectorCockpit";
import ReferAndEarn from "@/app/components/ReferAndEarn";
import Billing from "@/app/components/Billing";

// Settings.
//
// Connecting your accounts is why most people come here, so it is the page rather than a
// section of it. Connecting used to be spread across three screens — this one, the
// publishing page and the connector cockpit — and two of them posted to the reference
// endpoint, which fabricates a connection. There is one place and one real OAuth flow now.
//
// The cockpit still exists, with its event streams and sync history. It answers questions
// almost nobody has, so it sits under Advanced, closed, where anyone who needs it can still
// find it and everyone else never reads the word "connector".

/**
 * The exact callback URLs to register in the LinkedIn and X developer apps.
 *
 * Read from window.location.origin, which is the same origin the server builds the
 * redirect_uri from — so what is shown here is what actually gets sent. Providers compare
 * that string exactly and will not follow a redirect to reach it, which makes a mismatch
 * here the most common reason a connection fails after the user has already consented.
 */
function CallbackUrls() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  if (!origin) return null;
  return (
    <div className="set-callbacks">
      <h3>Callback URLs</h3>
      <p>Register these exactly, in the LinkedIn and X developer apps.</p>
      <code>{origin}/api/social/oauth/linkedin/callback</code>
      <code>{origin}/api/social/oauth/x/callback</code>
    </div>
  );
}

export default function SettingsPage() {
  const [advanced, setAdvanced] = useState(false);

  return (
    <section className="st-section">
      <header className="st-shead">
        <h1>Settings</h1>
        <p>Connect the accounts Populr posts to. Nothing goes out anywhere you haven&apos;t connected.</p>
      </header>

      <div className="set-block">
        <h2 className="set-h2">Accounts</h2>
        <AccountConnections variant="full" />
      </div>

      <div className="set-block">
        <h2 className="set-h2">Plan</h2>
        <Billing />
      </div>

      <div className="set-block">
        <h2 className="set-h2">Refer and earn</h2>
        <ReferAndEarn />
      </div>

      <div className="set-block">
        <button className="set-disclose" aria-expanded={advanced} onClick={() => setAdvanced((v) => !v)}>
          Advanced
        </button>
        {advanced ? (
          <div className="set-adv">
            <CallbackUrls />
            <p className="set-adv-note">
              Data sources behind Populr&apos;s analysis, and their sync history. These are not the
              accounts it posts to — none of this needs touching for publishing to work.
            </p>
            <ConnectorCockpit />
          </div>
        ) : (
          <p className="set-adv-hint">Data sources, sync history, event stream.</p>
        )}
      </div>
    </section>
  );
}
