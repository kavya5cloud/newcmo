"use client";

import { useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";
import { describeWhen } from "@/lib/assistant/status";
import type { AssistantStatus } from "@/lib/assistant/types";

// What you see when you open Populr.
//
// Not a page you navigate to — the first thing, above everything else. A founder logging in
// is asking one question, "is my marketing handled and does anything need me", and this
// answers it in the first three lines. The dashboard is still underneath for anyone who
// wants to dig; nobody has to.
//
// The greeting and the assistant's status used to be two separate ideas in two places.
// They are one screen because they are one thought.

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function HomeHero({ company }: { company?: string }) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);

  useEffect(() => {
    fetch(`/api/assistant?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setStatus(d.status); })
      .catch(() => {});   // the hero degrades to the greeting; it is never the reason a page fails
  }, []);

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

    </section>
  );
}
