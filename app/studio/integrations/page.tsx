"use client";

import { useEffect, useState } from "react";
import AccountConnections from "@/app/components/AccountConnections";
import ConnectorCockpit from "./ConnectorCockpit";
import ReferAndEarn from "@/app/components/ReferAndEarn";
import Billing from "@/app/components/Billing";
import Icon, { type IconName } from "@/app/components/Icon";

// Settings.
//
// Was one page scrolling through Accounts, Plan, Refer and earn, and a disclosure holding
// the connector cockpit. Everything was reachable, and everything was reachable at once —
// which means the page had no shape and the eye had nowhere to rest. Billing sat below the
// fold on a laptop, so the panel a paying customer needs was the hardest thing to find.
//
// A grouped rail with one section on screen at a time. Each pane is a whole subject rather
// than a slice, which is why the rail is grouped rather than a flat list of six links: the
// groups are the answer to "where would I look for this".
//
// The panes themselves are the components that already worked. Nothing about connecting an
// account or reading a plan changed here — only where they live and how you get to them.

type SectionId = "accounts" | "sources" | "plan" | "refer" | "callbacks";
type Item = { id: SectionId; label: string; blurb: string; icon: IconName; dot?: boolean };

// Typed explicitly rather than inferred from `as const`. flatMap over a readonly tuple of
// readonly tuples widens in a way TypeScript will not accept back into the element type, and
// the error it produces is four screens long and says nothing useful.
const SECTIONS: { group: string; items: Item[] }[] = [
  {
    group: "AI CMO",
    items: [
      { id: "accounts", label: "Accounts", blurb: "Where Populr is allowed to post. Nothing goes out anywhere you have not connected.", icon: "cast", dot: true },
      { id: "sources", label: "Data sources", blurb: "What Populr reads to build its analysis, and when each last synced.", icon: "chart" },
    ],
  },
  {
    group: "Billing",
    items: [
      { id: "plan", label: "Plan", blurb: "Your subscription, what it costs, and when it renews.", icon: "package" },
      { id: "refer", label: "Refer and earn", blurb: "Three referrals adds another free month. They each get one too.", icon: "megaphone", dot: true },
    ],
  },
  {
    group: "Developer",
    items: [
      { id: "callbacks", label: "Callback URLs", blurb: "The exact redirect URLs to register in your LinkedIn and X developer apps.", icon: "doc" },
    ],
  },
];

const ALL: Item[] = SECTIONS.flatMap((g) => g.items);
const isSectionId = (v: string): v is SectionId => ALL.some((i) => i.id === v);

/**
 * The exact callback URLs to register in the LinkedIn and X developer apps.
 *
 * Read from window.location.origin, which is the same origin the server builds redirect_uri
 * from — so what is shown is what actually gets sent. Providers compare that string exactly
 * and will not follow a redirect to reach it, which makes a mismatch here the most common
 * reason a connection fails after the person has already consented.
 */
function CallbackUrls() {
  const [origin, setOrigin] = useState("");
  // In an effect, not during render: window does not exist on the server, and reading it
  // inline makes the first client render disagree with the HTML that was sent.
  useEffect(() => setOrigin(window.location.origin), []);
  if (!origin) return null;
  return (
    <div className="set-callbacks">
      <code>{origin}/api/social/oauth/linkedin/callback</code>
      <code>{origin}/api/social/oauth/x/callback</code>
      <p className="set-hint">
        Paste them exactly. A trailing slash or the wrong host is rejected after the person has
        already approved access, which looks like the connection silently failing.
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>("accounts");

  // The hash carries the section, so a link into Settings can land on the right pane and a
  // refresh does not throw you back to Accounts. Read in an effect for the same reason as
  // above — and kept in sync with the back button, which otherwise changes the URL and
  // nothing else.
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (isSectionId(h)) setActive(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  const go = (id: SectionId) => {
    setActive(id);
    // replaceState rather than a hash assignment: this should not stack a history entry per
    // click, or leaving Settings means pressing back once per pane visited.
    window.history.replaceState(null, "", `#${id}`);
  };

  const meta = ALL.find((i) => i.id === active)!;

  return (
    <section className="st-section settings">
      <header className="set-head">
        {/* Back before the title, and a real link rather than history.back() — someone who
            opened Settings directly has nothing to go back to, and a chevron that does
            nothing is worse than no chevron. */}
        <a className="set-back" href="/app" aria-label="Back to the dashboard">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </a>
        <h1>Settings</h1>
      </header>

      <div className="set-shell">
        <nav className="set-rail" aria-label="Settings sections">
          {SECTIONS.map((g) => (
            <div className="set-grp" key={g.group}>
              <p className="set-grp-t">{g.group}</p>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  className={"set-nav" + (active === item.id ? " on" : "")}
                  aria-current={active === item.id ? "page" : undefined}
                  onClick={() => go(item.id)}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                  {/* A quiet marker on the rows that have something to act on. Not a count —
                      a count that is wrong is worse than no count, and these are cheap. */}
                  {item.dot && <i className="set-dot" aria-hidden="true" />}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="set-pane">
          {/* Every pane opens with its own title and one line saying what it is for. The old
              page had a single description at the top covering four unrelated subjects, so
              three of them went unexplained. */}
          <div className="set-pane-head">
            <h2>{meta.label}</h2>
            <p>{meta.blurb}</p>
          </div>

          {active === "accounts" && <AccountConnections variant="full" />}
          {active === "plan" && <Billing />}
          {active === "refer" && <ReferAndEarn />}
          {active === "callbacks" && <CallbackUrls />}
          {active === "sources" && <ConnectorCockpit />}
        </div>
      </div>
    </section>
  );
}
