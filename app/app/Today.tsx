"use client";
import { useCallback, useEffect, useState } from "react";
import type { ActivityLine, DailyBrief } from "@/lib/brief/types";
import { headline } from "@/lib/brief/headline";

// The dashboard.
//
// It answers one question — what should I do right now? — and everything on it earns its
// place against that question or is not here. Five blocks, in the order a person actually
// needs them: where am I, what's the one move, what are the numbers behind it, where else
// can I go, what just happened.
//
// What used to be here and is not any more: the AI paragraph (the engine still writes it,
// the digest still sends it — a dashboard is not the place to read prose), the expandable
// market/performance/upcoming detail (each of those screens owns its own numbers, and a
// second copy is just a second thing to keep in sync), and the second and third
// recommendation. There is only ever one next thing.

const TIME = { hour: "2-digit", minute: "2-digit" } as const;

const ACTIONS: [string, string][] = [
  ["Create Content", "/studio/documents"],
  ["Launch Workspace", "/studio/launch"],
  ["Campaigns", "/app/campaigns"],
  ["Images", "/studio/images"],
  ["UGC", "/studio/ugc"],
  ["Drafts", "/studio/social"],
];

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** Three shapes, not eleven. An icon here is a category marker, not information. */
function ActivityIcon({ kind }: { kind: string }) {
  const bad = /fail|blocked|behind|disconnect|underperform/.test(kind);
  const agent = kind.startsWith("agent:") || kind === "asset";
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" {...stroke} aria-hidden="true">
      {bad ? (
        <><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5M12 16h.01" /></>
      ) : agent ? (
        <path d="M12 4.5l1.9 4.4 4.6.5-3.5 3.1 1 4.6-4-2.4-4 2.4 1-4.6L5.5 9.4l4.6-.5L12 4.5z" />
      ) : (
        <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></>
      )}
    </svg>
  );
}

export default function Today({ company }: { company?: string }) {
  const [brief, setBrief] = useState<DailyBrief | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      if (company) q.set("company", company);
      const d = await fetch(`/api/brief?${q}`).then((r) => r.json());
      if (d?.ok) setBrief(d.brief);
      else setFailed(true);
    } catch { setFailed(true); }
  }, [company]);

  useEffect(() => { load(); }, [load]);

  // A brief that never arrives must not take the page down with it: the greeting degrades
  // to a plain one, the recommendation and stats drop out, and the actions — which are
  // static links and always correct — stay.
  const rec = brief?.recommendation;
  const activity: ActivityLine[] = brief?.activity.slice(0, 3) ?? [];
  const stats: [number, string, string][] = brief
    ? [
        [brief.publishing.today, "Publishing today", "/studio/social"],
        [brief.approvals.count, "Awaiting approval", "/studio/launch#execution"],
        [brief.campaigns.running, "Running campaigns", "/studio/launch#campaigns"],
      ]
    : [];

  return (
    <section className="today" aria-label="Today">
      <header className="td-hello">
        <h1>{brief ? `${brief.greeting}, ${brief.company}` : company ? `Hello, ${company}` : "Hello"}</h1>
        {brief ? <p>{headline(brief)}</p> : <p className={failed ? undefined : "td-wait"}>{failed ? "Today's status is unavailable." : "Reading your workspace…"}</p>}
      </header>

      {/* Two groups, so a laptop can put the decisions on the left and the reference on
          the right. On a phone both are display:contents and the five blocks stay one
          straight column, in the order they are written. */}
      <div className="td-main">
        {rec && (
          <a className="td-next" href={rec.href || "/studio"}>
            <span className="td-next-body">
              <span className="td-next-k">Do this next</span>
              <span className="td-next-t">{rec.title}</span>
            </span>
            <span className="td-next-go" aria-hidden="true">Start</span>
          </a>
        )}

        <nav className="td-grid" aria-label="Quick actions">
          {ACTIONS.map(([label, href]) => (
            <a className="td-tile" key={href} href={href}>{label}</a>
          ))}
        </nav>
      </div>

      <div className="td-rail">
        {stats.length > 0 && (
          <div className="td-stats">
            {stats.map(([n, label, href]) => (
              <a className="td-stat" key={label} href={href}>
                <b>{n}</b>
                <span>{label}</span>
              </a>
            ))}
          </div>
        )}

        {activity.length > 0 && (
          <div className="td-feed">
            <div className="td-feed-head">
              <span>Activity</span>
              <a href="/studio/jobs">View all</a>
            </div>
            {activity.map((a, i) => (
              <div className="td-row" key={`${a.at}-${i}`}>
                <span className="td-row-ic"><ActivityIcon kind={a.kind} /></span>
                <span className="td-row-t">{a.message}</span>
                <span className="td-row-at">{new Date(a.at).toLocaleTimeString([], TIME)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
