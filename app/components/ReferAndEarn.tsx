"use client";

import { useCallback, useEffect, useState } from "react";

// Refer three people, get another month.
//
// The number shown is counted from real signups that used this code. It never counts clicks,
// invites sent, or links copied — a referral programme that inflates its own numbers is
// worse than none, because the first time someone notices the count is not real they stop
// believing the reward is either.

type Progress = {
  code: string;
  link: string;
  referred: number;
  rewards: number;
  bonusDays: number;
  toNextReward: number;
  pending: number;
  summary: string;
  terms: { perReward: number; rewardDays: number };
};

export default function ReferAndEarn() {
  const [data, setData] = useState<Progress | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/referrals", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => (d?.ok ? setData(d) : setErr(d?.error === "sign_in_required" ? "Sign in to get your link." : null)))
      .catch(() => setErr(null));   // a missing panel is better than a broken one
  }, []);

  const copy = useCallback(async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Couldn't copy — select the link and copy it manually.");
    }
  }, [data]);

  if (err) return <p className="set-adv-hint">{err}</p>;
  if (!data) return null;

  const { perReward, rewardDays } = data.terms;
  // Progress towards the *next* reward, not all time — otherwise the bar sits full forever
  // after the first month is earned.
  const towards = data.referred % perReward;

  return (
    <div className="refer">
      <p className="refer-lede">
        Refer {perReward} people and get another {rewardDays} days free. They each get their
        free month too.
      </p>

      <div className="refer-link">
        <code>{data.link}</code>
        <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>

      <div className="refer-progress" role="group" aria-label="Referral progress">
        <div className="refer-pips" aria-hidden="true">
          {Array.from({ length: perReward }, (_, i) => (
            <span key={i} className={i < towards ? "on" : ""} />
          ))}
        </div>
        <span className="refer-count">{data.summary}</span>
      </div>

      {data.pending > 0 && (
        <p className="refer-pending">
          {data.pending} signed up but {data.pending === 1 ? "hasn't" : "haven't"} added a
          website yet — {data.pending === 1 ? "it counts" : "they count"} once they do.
        </p>
      )}

      {data.bonusDays > 0 && (
        <p className="refer-earned">
          <strong>{data.bonusDays} days</strong> added to your trial so far.
        </p>
      )}

      {/* Said plainly, because the alternative is someone sending twenty links and then
          asking why nothing was credited. */}
      <p className="refer-fine">
        A referral counts once they create an account from your link and add their website.
        Your own account doesn&apos;t count.
      </p>
    </div>
  );
}
