import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { normalizeCode, REFERRALS_PER_REWARD, REWARD_DAYS } from "@/lib/referrals";
import JoinForm from "./JoinForm";

// The page a referral link opens.
//
// One job: turn an invitation into an account. Everything a marketing page would say has
// already been said by whoever shared the link, so this does not repeat it — it states the
// offer, takes an email and a password, and gets out of the way.
//
// Deliberately says nothing about who referred them. The referrer's email is not this
// visitor's business, and a page that names a stranger reads as a leak rather than a
// welcome.

export const metadata: Metadata = {
  title: "You're invited",
  description: "Create your Populr account and get your first month free.",
  alternates: { canonical: "/join" },
  // Invitation links are personal and there are as many as there are users. None of them
  // belong in a search index.
  robots: { index: false, follow: false },
};

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode((await params).code);

  // A malformed or truncated code — the usual cause is a link broken across two lines in a
  // message. Send them to the normal signup rather than showing an error they cannot act on;
  // they still get an account, only the credit is lost.
  if (!code) redirect("/app");

  return (
    <div className="join-page">
      <main className="join-card">
        <span className="join-brand">Populr<span className="join-acc">.</span></span>

        <h1>You&apos;ve been invited.</h1>
        <p className="join-lede">
          Create your account and Populr starts running your marketing — writing posts,
          scheduling them, and sending you only what needs a decision.
        </p>

        <div className="join-offer">
          <strong>Your first month is free.</strong>
          <span>
            Refer {REFERRALS_PER_REWARD} people yourself and you get another {REWARD_DAYS} days.
          </span>
        </div>

        <JoinForm code={code} />
      </main>
    </div>
  );
}
