"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { workspaceId } from "@/lib/store";
import type { Tomorrow } from "@/lib/tomorrow/assemble";

// The end-of-day read.
//
// One screen, one decision. Everything on it was already decided by the agents; the founder
// is reading, not filling anything in. That constraint is why there is no filter, no tab, no
// column layout and exactly two buttons — the moment a second decision appears here it
// becomes the control panel it exists to replace.
//
// The skipped list is not padding. It is the only part of this product a competitor cannot
// copy by Friday, and it is the difference between "your CMO did nine things" and "your CMO
// considered thirteen and can tell you why it dropped four".

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

const dayName = (at: number) =>
  new Date(at).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

type Payload = { ok: true; tomorrow: Tomorrow; headline: string };

export default function TomorrowPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The browser knows the founder's day; the server cannot. Asking at 23:00 in Bengaluru
  // means the next day there, not the one that started in Greenwich.
  const tz = typeof window === "undefined" ? 0 : -new Date().getTimezoneOffset();

  const load = useCallback(async () => {
    try {
      const d = await fetch(`/api/tomorrow?wsid=${encodeURIComponent(workspaceId())}&tz=${tz}`, { cache: "no-store" })
        .then((r) => r.json());
      if (!d?.ok) { setErr("Tomorrow's plan could not be read just now."); return; }
      setData(d); setErr(null);
    } catch { setErr("Tomorrow's plan could not be read just now."); }
  }, [tz]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (action: "approve" | "skip", id?: string) => {
    setBusy(id ?? action);
    try {
      const r = await fetch("/api/tomorrow", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, tz, wsid: workspaceId() }),
      });
      if (r.status === 401) { setErr("Sign in to approve tomorrow's plan."); return; }
      if (!r.ok) { setErr("That didn't go through. Try again."); return; }
      if (action === "approve") setDone(true);
      await load();
    } catch { setErr("That didn't go through. Try again."); }
    finally { setBusy(null); }
  }, [load, tz]);

  if (err && !data) return <main className="tm"><p className="conn-err" role="alert">{err}</p></main>;
  if (!data) return null;

  const t = data.tomorrow;

  return (
    <main className="tm">
      <header className="tm-head">
        <span className="tm-day">{dayName(t.from)}</span>
        <h1 className="tm-h1">{data.headline}</h1>
      </header>

      {/* One way onward, and only one. This page is outside the workspace on purpose — a
          founder should be able to read it and stop — but a screen with no exit is a dead
          end rather than a decision. */}
      <Link className="tm-more" href="/studio/launch">See how the team decided this →</Link>

      {err && <p className="conn-err" role="alert">{err}</p>}

      {t.posts.length > 0 && (
        <ol className="tm-list">
          {t.posts.map((p) => (
            <li key={p.id} className="tm-post">
              <span className="tm-time">{time(p.at)}</span>
              <span className="tm-body">
                <span className="tm-where">
                  {p.platformLabel}
                  {/* A slot for a platform that cannot publish is the most expensive lie on
                      this page: it reads as scheduled and silently never happens. */}
                  {!p.willActuallyPublish && <em className="tm-warn">writing only — not connected</em>}
                </span>
                <span className="tm-what">{p.angle}</span>
                <span className="tm-form">{p.form}</span>
              </span>
              <button
                className="tm-drop" disabled={busy === p.id}
                onClick={() => act("skip", p.id)}
                title="Don't post this"
              >
                {busy === p.id ? "…" : "Not this one"}
              </button>
            </li>
          ))}
        </ol>
      )}

      {t.posts.length === 0 && (
        <p className="tm-empty">
          {t.idleReason === "not_configured" && (
            <>Populr hasn&apos;t been told what to work on yet. <Link href="/app">Start here</Link>.</>
          )}
          {t.idleReason === "paused" && (
            <>Nothing will go out until you resume it. <Link href="/studio/social">Resume</Link>.</>
          )}
          {t.idleReason === "nothing_due" && (
            <>Tomorrow is clear. That is sometimes the right plan — posting to a schedule you
              can&apos;t sustain costs more than a quiet day.</>
          )}
        </p>
      )}

      {t.skipped.length > 0 && (
        <section className="tm-skip">
          <h2 className="tm-h2">And {t.skipped.length} thing{t.skipped.length === 1 ? "" : "s"} it decided not to do</h2>
          <ul className="tm-skip-list">
            {t.skipped.map((s, i) => (
              <li key={i}>
                <span className="tm-skip-what">{s.proposed}</span>
                <span className="tm-skip-why">{s.reason} — {s.explanation}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The one decision. Present only when there is genuinely something to decide: an
          approve button over an already-approved plan trains people to click without
          reading, which is worse than not having one. */}
      {t.awaiting > 0 ? (
        <div className="tm-decide">
          <button className="tm-go" disabled={busy === "approve"} onClick={() => act("approve")}>
            {busy === "approve" ? "Approving…" : `Looks good — send all ${t.awaiting}`}
          </button>
          <span className="tm-decide-note">Nothing goes out until you press this.</span>
        </div>
      ) : (
        <p className="tm-decide-note tm-standalone">
          {done
            ? "Approved. Populr will handle the rest."
            : t.posts.length > 0
              ? "Nothing needs your approval — Populr will publish these itself."
              : ""}
        </p>
      )}
    </main>
  );
}
