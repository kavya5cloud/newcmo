"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";

// Early Access rotating banner + application modal.
// Presentation only — it posts to /api/early-access (the single intake seam) and
// mirrors the interest enum in lib/early-access.ts (EA_INTERESTS). Mounted globally
// in the root layout so it sits at the very top of the application, EXCEPT the /app
// product shell (a fixed 100svh layout the banner must not push off-screen).
//
// It pins to the top and publishes its height as --eab-h so sticky sub-navigation
// (landing nav, studio sidebar) can offset beneath it instead of overlapping.

const BANNER_H = 44; // px — fixed single-line height so the offset is deterministic

const SLIDES: string[] = [
  "Create complete product launches, not just content.",
  "Launch videos, UGC videos, motion graphics and premium creatives are coming.",
  "Join the Early Access Program and get priority access.",
  "Limited beta spots available. Help shape the future of Populr.",
];

const ROTATE_MS = 5500;

// value must match EA_INTERESTS in lib/early-access.ts
const INTERESTS: { value: string; label: string }[] = [
  { value: "launch_videos", label: "Launch Videos" },
  { value: "ugc_videos", label: "UGC Videos" },
  { value: "motion_graphics", label: "Motion Graphics" },
  { value: "ai_creative_studio", label: "AI Creative Studio" },
  { value: "ai_campaigns", label: "AI Campaigns" },
];

const TEAM_SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"];

export default function EarlyAccessBanner() {
  const path = usePathname();
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [hover, setHover] = useState(false);

  // Never render on the /app product shell (fixed 100svh layout).
  const suppressed = path?.startsWith("/app") || path === "/studio/blitz";
  const hidden = dismissed || suppressed;

  // Publish the banner height so sticky sub-navs can offset below it (0 when hidden).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--eab-h", hidden ? "0px" : `${BANNER_H}px`);
    return () => root.style.setProperty("--eab-h", "0px");
  }, [hidden]);

  // Rotate the slides; pause while hovering or while the modal is open.
  useEffect(() => {
    if (open || hover || hidden) return;
    const t = setInterval(() => setI((n) => (n + 1) % SLIDES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [open, hover, hidden]);

  // Restore a prior dismissal so the bar doesn't nag on every navigation.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("ea_banner_dismissed") === "1") setDismissed(true);
    } catch { /* sessionStorage unavailable — show the banner */ }
  }, []);

  const close = useCallback(() => setOpen(false), []);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  function dismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setDismissed(true);
    try { sessionStorage.setItem("ea_banner_dismissed", "1"); } catch { /* ignore */ }
  }

  if (hidden) return null;

  return (
    <>
      <div
        className="eab"
        role="button"
        tabIndex={0}
        aria-label="Apply for Early Access"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div className="eab-msg" key={i}>
          <span className="eab-text">{SLIDES[i]}</span>
        </div>
        <div className="eab-right">
          <button className="eab-cta" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
            Apply for Early Access
          </button>
          <div className="eab-dots" aria-hidden="true">
            {SLIDES.map((_, n) => <span key={n} className={"eab-dot" + (n === i ? " on" : "")} />)}
          </div>
          <button className="eab-x" aria-label="Dismiss" onClick={dismiss}>×</button>
        </div>
      </div>

      {open && <EarlyAccessModal onClose={close} />}
    </>
  );
}

function EarlyAccessModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);

  function toggle(v: string) {
    setInterests((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(null);
    const f = new FormData(e.currentTarget);
    const payload = {
      email: String(f.get("email") || ""),
      company: String(f.get("company") || ""),
      website: String(f.get("website") || ""),
      teamSize: String(f.get("teamSize") || ""),
      project: String(f.get("project") || ""),
      interests,
    };
    try {
      const r = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        setErr(d.error === "invalid" ? "Please enter a valid work email." : "Something went wrong — please try again.");
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
    <div className="eam-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Apply for Early Access">
      <div className="eam" onClick={(e) => e.stopPropagation()}>
        <button className="eam-close" aria-label="Close" onClick={onClose}>×</button>

        {done ? (
          <div className="eam-done">
            <div className="eam-done-badge">✓</div>
            <h2>You&apos;re on the list</h2>
            <p>Thanks for applying to Populr Early Access. We&apos;ll reach out as spots open up — keep an eye on your inbox.</p>
            <button className="eam-submit" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="eam-head">
              <span className="label">Early Access</span>
              <h2>Help shape the future of Populr</h2>
              <p>Priority access to launch videos, UGC, motion graphics and the AI Creative Studio.</p>
            </div>

            <form className="eam-form" onSubmit={submit}>
              <label className="eam-field">
                <span>Work Email <b>*</b></span>
                <input name="email" type="email" required placeholder="you@company.com" autoComplete="email" />
              </label>

              <div className="eam-row">
                <label className="eam-field">
                  <span>Company</span>
                  <input name="company" placeholder="Acme Inc." />
                </label>
                <label className="eam-field">
                  <span>Website</span>
                  <input name="website" placeholder="acme.com" />
                </label>
              </div>

              <label className="eam-field">
                <span>Team Size</span>
                <select name="teamSize" defaultValue="">
                  <option value="" disabled>Select…</option>
                  {TEAM_SIZES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>

              <label className="eam-field">
                <span>What are you building?</span>
                <textarea name="project" rows={3} placeholder="A short line about your product or goal." />
              </label>

              <fieldset className="eam-interests">
                <legend>I&apos;m most interested in</legend>
                <div className="eam-checks">
                  {INTERESTS.map((it) => (
                    <label key={it.value} className={"eam-check" + (interests.includes(it.value) ? " on" : "")}>
                      <input type="checkbox" checked={interests.includes(it.value)} onChange={() => toggle(it.value)} />
                      <span>{it.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {err && <div className="eam-err">{err}</div>}

              <button className="eam-submit" type="submit" disabled={busy}>
                {busy ? "Joining…" : "Join Early Access"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
