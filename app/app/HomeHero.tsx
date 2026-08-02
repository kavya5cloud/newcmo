"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { workspaceId } from "@/lib/store";
import { routeIntent } from "@/lib/services/intent-router";
import { describeWhen } from "@/lib/assistant/status";
import { SHOW_CONTENT_ENGINE } from "@/lib/flags";
import type { AssistantStatus } from "@/lib/assistant/types";

// What you see when you open Populr.
//
// Not a page you navigate to — the first thing, above everything else. A founder logging in
// is asking one question, "is my marketing handled and does anything need me", and this
// answers it in the first three lines. The dashboard is still underneath for anyone who
// wants to dig; nobody has to.
//
// The greeting, the assistant's status and the ask-for-anything box used to be three
// separate ideas in three places. They are one screen because they are one thought.

// Chosen so each one lands somewhere real. Checked by a test, because a suggestion that
// leads nowhere is worse than no suggestion.
const SUGGESTIONS = [
  "Launch my product next week",
  "Grow my LinkedIn",
  "Announce version 2",
  "Bring more traffic",
];

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Where an intent goes.
 *
 * Uses the router the product already has rather than a second set of rules. Content routes
 * are gated: while the writing surface is switched off, sending someone there lands them on
 * a redirect, so this says so instead.
 */
function destinationFor(text: string): { href: string; note?: string } {
  const { intent } = routeIntent(text);

  // "Launch my product", "announce version 2", "bring more traffic" are all the same
  // shape: something to plan. The router separates campaign from strategy, but both land
  // in the same place from a user's point of view — the plan.
  if (intent === "campaign" || intent === "strategy") return { href: "/app/campaigns" };
  // "How did last month go" is the one that belongs with results.
  if (intent === "analysis") return { href: "/studio/learning" };

  // content | edit | transform — all need the writing surface.
  if (!SHOW_CONTENT_ENGINE) {
    return { href: "", note: "Writing is switched off right now. Everything else still works." };
  }
  return { href: "/studio" };
}

export default function HomeHero({ company }: { company?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [ask, setAsk] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/assistant?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setStatus(d.status); })
      .catch(() => {});   // the hero degrades to the greeting; it is never the reason a page fails
  }, []);

  const go = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    const { href, note: n } = destinationFor(t);
    if (!href) { setNote(n ?? null); return; }
    router.push(`${href}?ask=${encodeURIComponent(t)}`);
  }, [router]);

  const configured = status?.configured;

  return (
    <section className="home-hero" aria-label="Your marketing">
      <p className="home-greet">
        {greeting()}{company ? `, ${company}` : ""}.
      </p>

      {/* One line that answers "do I need to worry". */}
      <h1 className="home-line">
        {!configured
          ? "Let's get your marketing running."
          : status!.paused
            ? "Your marketing is paused."
            : "Your marketing is running."}
      </h1>

      {configured && !status!.paused && (
        <ul className="home-facts">
          <li>
            <span aria-hidden="true">✓</span>
            {status!.plannedThisWeek} {status!.plannedThisWeek === 1 ? "post" : "posts"} this week
          </li>
          {status!.nextPublishAt && (
            <li>
              <span aria-hidden="true">✓</span>
              Next post {describeWhen(status!.nextPublishAt).toLowerCase()}
            </li>
          )}
        </ul>
      )}

      {/* The only thing that is ever asked of the user, and only when it is true. */}
      {configured && status!.awaitingApproval > 0 && (
        <div className="home-needs">
          <p>
            <strong>Needs you:</strong>{" "}
            {status!.awaitingApproval} {status!.awaitingApproval === 1 ? "post" : "posts"} waiting for approval
          </p>
          <a className="home-cta" href="/studio/social">Review</a>
        </div>
      )}

      {!configured && (
        <div className="home-needs">
          <p>Four questions, about a minute. Then Populr takes it from there.</p>
          <a className="home-cta" href="/app/assistant">Set up my marketing</a>
        </div>
      )}

      {/* Ask for anything. Navigation is for people who already know where things live; this
          is for everyone else. */}
      <form className="home-ask" onSubmit={(e) => { e.preventDefault(); go(ask); }}>
        <label htmlFor="home-ask-input">What would you like to achieve?</label>
        <div className="home-ask-row">
          <input
            id="home-ask-input" value={ask} placeholder="Launch my product next week"
            onChange={(e) => { setAsk(e.target.value); setNote(null); }}
          />
          <button type="submit" disabled={!ask.trim()}>Go</button>
        </div>
        <div className="home-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => { setAsk(s); go(s); }}>{s}</button>
          ))}
        </div>
        {note && <p className="home-note">{note}</p>}
      </form>
    </section>
  );
}
