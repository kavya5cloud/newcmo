"use client";
import { useState, type FormEvent, type ReactNode } from "react";

// Early Access Program — premium application page, native to Populr's dark/mono
// aesthetic (brand green/teal, not bolt-on blue). Progressive-enhancement form:
// posts JSON to /api/early-access, swaps to an animated success state on 200.

type Benefit = { icon: ReactNode; title: string };

const I = (paths: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);

const BENEFITS: Benefit[] = [
  { icon: I(<><path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.8-.8.8-2.2 0-3s-2.2-.8-3 0Z" /><path d="M12 15 9 12c1-3.5 3-6.5 8-8 .5 3.5-.5 7-8 8Z" /><path d="M14.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" /></>), title: "Early access to new features" },
  { icon: I(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3Z" /></>), title: "Influence the product roadmap" },
  { icon: I(<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>), title: "Direct feedback channel with the founder" },
  { icon: I(<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />), title: "Priority support" },
  { icon: I(<><rect x="3.5" y="8.5" width="17" height="12" rx="1.5" /><path d="M3.5 12h17M12 8.5v12" /><path d="M12 8.5S10.5 4 8 4a2 2 0 0 0 0 4.5ZM12 8.5S13.5 4 16 4a2 2 0 0 1 0 4.5Z" /></>), title: "Founding member benefits" },
  { icon: I(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /><circle cx="12" cy="15" r="1.2" fill="currentColor" /></>), title: "Exclusive product updates" },
];

export default function EarlyAccess() {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    const payload = {
      name: String(f.get("name") || ""),
      email: String(f.get("email") || ""),
      company: String(f.get("company") || ""),
      website: String(f.get("website") || ""),
      industry: String(f.get("industry") || ""),
      marketingChallenge: String(f.get("marketingChallenge") || ""),
    };
    try {
      const r = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        setErr(d.error === "invalid" ? "Please enter a valid name and work email." : "Something went wrong — please try again.");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setErr("Network error — please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="ea">
      <div className="ea-glow" aria-hidden="true" />
      <nav className="ea-nav">
        <a href="/" className="ea-word">Populr.</a>
        <a href="/app" className="ea-signin">Open app →</a>
      </nav>

      {!done ? (
        <>
          <header className="ea-hero">
            <span className="ea-badge"><span className="ea-spark">✦</span> Early Access Program</span>
            <h1>Get Early Access to Populr</h1>
            <p className="ea-sub">
              Join a select group of founders and marketers helping shape the future of AI-powered marketing.
              Get early access to new features, exclusive updates, and direct communication with the team.
            </p>
            <div className="ea-cta">
              <a href="#apply" className="ea-btn ea-btn-pri">Join Early Access</a>
              <a href="#why" className="ea-btn ea-btn-sec">Learn More</a>
            </div>
            <p className="ea-trust">limited early cohort · no spam · unsubscribe anytime</p>
          </header>

          <section id="why" className="ea-why">
            <p className="ea-eyebrow">Why join</p>
            <div className="ea-cards">
              {BENEFITS.map((b, i) => (
                <div className="ea-card" key={i} style={{ animationDelay: `${i * 70}ms` }}>
                  <span className="ea-ico">{b.icon}</span>
                  <span className="ea-ctitle">{b.title}</span>
                </div>
              ))}
            </div>
          </section>

          <section id="apply" className="ea-apply">
            <div className="ea-form-wrap">
              <p className="ea-eyebrow">Request access</p>
              <h2>Apply to the program</h2>
              <p className="ea-formsub">Tell us a little about you. We review applications personally.</p>
              <form className="ea-form" onSubmit={submit}>
                <div className="ea-row">
                  <label className="ea-field">
                    <span>Full name *</span>
                    <input name="name" required autoComplete="name" placeholder="Kavya Sharma" />
                  </label>
                  <label className="ea-field">
                    <span>Work email *</span>
                    <input name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
                  </label>
                </div>
                <div className="ea-row">
                  <label className="ea-field">
                    <span>Company <em>optional</em></span>
                    <input name="company" autoComplete="organization" placeholder="Acme Inc." />
                  </label>
                  <label className="ea-field">
                    <span>Website <em>optional</em></span>
                    <input name="website" placeholder="acme.com" />
                  </label>
                </div>
                <label className="ea-field">
                  <span>Industry <em>optional</em></span>
                  <input name="industry" placeholder="SaaS, e-commerce, agency…" />
                </label>
                <label className="ea-field">
                  <span>Biggest marketing challenge <em>optional</em></span>
                  <textarea name="marketingChallenge" rows={3} placeholder="What's the hardest part of marketing for you right now?" />
                </label>
                {err && <div className="ea-err" role="alert">{err}</div>}
                <button className="ea-submit" type="submit" disabled={busy}>
                  {busy ? "Submitting…" : "Request Early Access"}
                </button>
              </form>
            </div>
          </section>

          <footer className="ea-foot">
            <a href="/">Populr.</a>
            <div>
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
              <a href="mailto:team@trypopulr.in">Contact</a>
            </div>
          </footer>
        </>
      ) : (
        <div className="ea-success" role="status">
          <div className="ea-checkwrap" aria-hidden="true">
            <svg viewBox="0 0 52 52" className="ea-check">
              <circle cx="26" cy="26" r="24" fill="none" />
              <path fill="none" d="M15 27l7 7 15-16" />
            </svg>
          </div>
          <h1>You&apos;re on the list!</h1>
          <p>
            Thanks for joining the Populr Early Access Program. We&apos;ll keep you updated with product releases,
            exclusive previews, and opportunities to try new features before anyone else.
          </p>
          <a href="/" className="ea-btn ea-btn-sec">Back to home</a>
        </div>
      )}
    </div>
  );
}
