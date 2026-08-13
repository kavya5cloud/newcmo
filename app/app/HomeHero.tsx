"use client";

import { useEffect, useState } from "react";
import { workspaceId } from "@/lib/store";
import { describeWhen } from "@/lib/assistant/status";
import type { AssistantStatus } from "@/lib/assistant/types";
import Icon from "@/app/components/Icon";

// What you see when you open Populr.
//
// Not a page you navigate to — the first thing, above everything else. A founder logging in
// is asking one question, "is my marketing handled and does anything need me", and this
// answers it in the first three lines. The dashboard is still underneath for anyone who
// wants to dig; nobody has to.
//
// The greeting and the assistant's status used to be two separate ideas in two places.
// They are one screen because they are one thought.
//
// The setup prompt that used to sit here — "Four questions, about a minute" with a
// Set up my marketing button — is gone. It was a banner across the top of the dashboard
// selling a feature to someone already inside the product, and it pushed the actual work
// below the fold. The Assistant is still reachable from the nav for anyone who wants it.
//
// What stays is the one prompt that is not promotion: posts waiting for approval, shown
// only when there are some, because that is the product asking for something rather than
// offering it.

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
            <Icon name="check" size={13} />
            {status!.plannedThisWeek} {status!.plannedThisWeek === 1 ? "post" : "posts"} this week
          </li>
          {status!.nextPublishAt && (
            <li>
              <Icon name="check" size={13} />
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

    </section>
  );
}
