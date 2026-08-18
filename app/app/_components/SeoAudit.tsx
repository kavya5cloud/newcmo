"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditResult, ScoreSet, Vital, SeoSignal } from "@/lib/seo/audit";

// The SEO tab, showing measurements.
//
// The rule this panel exists under: nothing here is generated. Scores come from Lighthouse,
// vitals come from Lighthouse, signals are read off the page's own HTML. Where a number could
// not be measured it shows an em dash and the reason — never a zero, because a zero is
// indistinguishable from a terrible score and this product does not get to be wrong in that
// direction.
//
// It replaced a panel that said "Connect Search Console to see queries" and nothing else. That
// was honest and useless: Search Console needs OAuth and a verified property, so a new user saw
// an empty tab for their entire first session. This needs neither.

const RING = 34;
const CIRC = 2 * Math.PI * 15;

/** Lighthouse's own bands: 90+ good, 50–89 needs work, under 50 poor. */
function band(n: number) {
  return n >= 90 ? "good" : n >= 50 ? "warn" : "bad";
}

function Ring({ value, label }: { value: number | null; label: string }) {
  const shown = value ?? null;
  return (
    <div className="psi-ring">
      <svg viewBox="0 0 34 34" width={RING} height={RING} aria-hidden="true">
        <circle cx="17" cy="17" r="15" className="psi-track" />
        {shown !== null && (
          <circle
            cx="17" cy="17" r="15"
            className={"psi-arc psi-" + band(shown)}
            strokeDasharray={`${(shown / 100) * CIRC} ${CIRC}`}
          />
        )}
      </svg>
      <span className={"psi-num" + (shown === null ? " psi-none" : " psi-" + band(shown))}>
        {shown === null ? "—" : shown}
      </span>
      <span className="psi-label">{label}</span>
    </div>
  );
}

function Scores({ title, s }: { title: string; s: ScoreSet }) {
  return (
    <div className="psi-block">
      <div className="psi-head">{title}</div>
      <div className="psi-rings">
        <Ring value={s.performance} label="Performance" />
        <Ring value={s.accessibility} label="Accessibility" />
        <Ring value={s.bestPractices} label="Best practices" />
        <Ring value={s.seo} label="SEO" />
      </div>
    </div>
  );
}

function Vitals({ vitals }: { vitals: Vital[] }) {
  if (!vitals.length) return null;
  return (
    <div className="cwv">
      {vitals.map((v) => (
        <div className="cwv-cell" key={v.id}>
          <span className={"cwv-dot cwv-" + v.verdict} aria-hidden="true" />
          <span className="cwv-label">{v.label}</span>
          <span className={"cwv-value cwv-" + v.verdict}>{v.display}</span>
          <span className="cwv-verdict">
            {v.verdict === "pass" ? "Pass" : v.verdict === "needs-work" ? "Needs work" : "Fail"}
          </span>
        </div>
      ))}
    </div>
  );
}

function Signals({ signals }: { signals: SeoSignal[] }) {
  if (!signals.length) return null;
  return (
    <div className="sig">
      {signals.map((s) => (
        // The note is a title attribute rather than always-visible text: seven explanations
        // stacked under seven rows turns a scannable table into an essay.
        <div className="sig-row" key={s.label} title={s.note}>
          <span className={"sig-dot sig-" + s.verdict} aria-hidden="true" />
          <span className="sig-label">{s.label}</span>
          <span className={"sig-value sig-" + s.verdict}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function SeoAudit({ url }: { url: string }) {
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [state, setState] = useState<"idle" | "running" | "error">("idle");
  const [err, setErr] = useState("");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  // The audit takes 20–40s. Without this guard, switching tabs away and back fires a second
  // run against a route that is still working on the first.
  const running = useRef(false);

  const run = useCallback(async () => {
    if (!url || running.current) return;
    running.current = true;
    setState("running"); setErr("");
    try {
      const r = await fetch(`/api/seo/audit?url=${encodeURIComponent(url)}`);
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.hint || d.error || `Failed (${r.status})`);
      setAudit(d.audit); setState("idle");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "The audit failed."); setState("error");
    } finally {
      running.current = false;
    }
  }, [url]);

  useEffect(() => { void run(); }, [run]);

  if (state === "running" && !audit) {
    return (
      <div className="audit-wait">
        <span className="btn-spin" aria-hidden="true" />
        <p>Running Lighthouse against {url.replace(/^https?:\/\//, "")}…</p>
        <p className="audit-sub">Two full audits, mobile and desktop. Usually 20–40 seconds.</p>
      </div>
    );
  }

  if (state === "error" && !audit) {
    return (
      <div className="audit-wait">
        <p className="bill-err" style={{ textAlign: "left" }}>{err}</p>
        <button className="bill-btn" onClick={() => void run()}>Try again</button>
      </div>
    );
  }

  if (!audit) return null;
  const vitals = audit.vitals[device];

  return (
    <div className="audit">
      <p className="an-s">
        Audited {new Date(audit.fetchedAt).toLocaleString()} · measured by Google Lighthouse
      </p>

      {/* Said out loud rather than shown as zeros. A missing measurement and a score of nought
          look identical on a dial, and only one of them is true. */}
      {audit.problems.length > 0 && (
        <div className="audit-problem">
          {audit.problems.map((p) => <div key={p}>{p}</div>)}
        </div>
      )}

      <div className="an-h">PageSpeed</div>
      <Scores title="Mobile" s={audit.mobile} />
      <Scores title="Desktop" s={audit.desktop} />

      {(audit.vitals.mobile.length > 0 || audit.vitals.desktop.length > 0) && (
        <>
          <div className="an-h" style={{ marginTop: 20 }}>Core Web Vitals</div>
          <div className="seg" role="tablist" aria-label="Device">
            {(["mobile", "desktop"] as const).map((d) => (
              <button
                key={d} role="tab" aria-selected={device === d}
                className={"seg-b" + (device === d ? " on" : "")}
                onClick={() => setDevice(d)}
              >
                {d === "mobile" ? "Mobile" : "Desktop"}
              </button>
            ))}
          </div>
          <Vitals vitals={vitals} />
          <p className="audit-note">Lab measurements. Real-world numbers vary with device and network.</p>
        </>
      )}

      {audit.signals.length > 0 && (
        <>
          <div className="an-h" style={{ marginTop: 20 }}>On-page signals</div>
          <div className="an-s">Read from your page&apos;s HTML</div>
          <Signals signals={audit.signals} />
        </>
      )}

      {audit.issues.length > 0 && (
        <>
          <div className="an-h" style={{ marginTop: 20 }}>
            Issues <span className="issue-count">{audit.issues.length}</span>
          </div>
          <div className="issues">
            {audit.issues.map((i) => (
              <div className={"issue issue-" + i.severity} key={i.title}>
                <div className="issue-t">{i.title}</div>
                <div className="issue-d">{i.detail}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <button className="bill-btn" style={{ marginTop: 18 }} onClick={() => void run()} disabled={state === "running"}>
        {state === "running" ? <span className="btn-spin" aria-label="Running" /> : "Run audit again"}
      </button>
    </div>
  );
}
