"use client";

import { useCallback, useEffect, useState } from "react";
import { humanError, humanThrow } from "@/lib/ui/errors";
import { workspaceId } from "@/lib/store";
import {
  ADVANCED_DEFAULTS, CADENCES, CADENCE_META, CONTROL_LEVELS, CONTROL_META,
  GOALS, GOAL_META, PLATFORM_CHOICES,
  type AdvancedSettings, type AssistantCadence, type AssistantSetup, type AssistantStatus,
  type ControlLevel, type Goal,
} from "@/lib/assistant/types";
import { describeWhen, headline } from "@/lib/assistant/status";
import type { SocialPlatform } from "@/lib/social/types";

// The Marketing Assistant.
//
// Four questions, then one screen that says whether your marketing is handled. Every word a
// business owner reads here is about their marketing, never about how Populr works — no
// queues, no rules, no pipelines, no scores. Those all still exist underneath; they are
// simply not this person's job.
//
// One question per screen with one primary action. A single form with four fields would be
// faster to build and worse to use: it turns four easy choices into one page of homework.

type Step = 0 | 1 | 2 | 3;
const LAST_STEP: Step = 3;

const PLATFORM_LABEL = Object.fromEntries(PLATFORM_CHOICES.map((p) => [p.platform, p.label])) as Record<SocialPlatform, string>;

export default function Assistant() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [advanced, setAdvanced] = useState<AdvancedSettings>(ADVANCED_DEFAULTS);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [editing, setEditing] = useState(false);

  const [step, setStep] = useState<Step>(0);
  const [cadence, setCadence] = useState<AssistantCadence | null>(null);
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([]);
  const [control, setControl] = useState<ControlLevel | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch(`/api/assistant?wsid=${encodeURIComponent(workspaceId())}`, { cache: "no-store" }).then((r) => r.json());
      if (!d?.ok) { setErr(humanError(d)); return; }
      setStatus(d.status);
      setAdvanced(d.advanced ?? ADVANCED_DEFAULTS);
      if (d.setup) {
        setCadence(d.setup.cadence); setPlatforms(d.setup.platforms);
        setControl(d.setup.control); setGoal(d.setup.goal);
      }
      setErr(null);
    } catch (e) { setErr(humanThrow(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = useCallback(async (body: Record<string, unknown>) => {
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, wsid: workspaceId() }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setErr(humanError(d, r.status)); return null; }
      return d;
    } catch (e) { setErr(humanThrow(e)); return null; }
    finally { setSaving(false); }
  }, []);

  const finish = useCallback(async () => {
    if (!cadence || !control || !goal || platforms.length === 0) return;
    const d = await send({ cadence, platforms, control, goal } satisfies AssistantSetup & Record<string, unknown>);
    if (!d) return;
    setStatus(d.status);
    setEditing(false);
    setStep(0);
  }, [cadence, platforms, control, goal, send]);

  const togglePause = useCallback(async () => {
    const d = await send({ op: status?.paused ? "resume" : "pause" });
    if (d) load();
  }, [send, status?.paused, load]);

  if (loading) return <div className="asst-wrap"><p className="asst-quiet">Loading…</p></div>;

  // ---------------------------------------------------------------- Status
  const configured = status?.configured && !editing;

  if (configured && status) {
    const early = status.earlyAccessPlatforms;
    return (
      <div className="asst-wrap">
        <section className="asst-status">
          <h1>Marketing Assistant</h1>
          <p className={"asst-state" + (status.paused ? " off" : "")}>
            <span aria-hidden="true">{status.paused ? "❚❚" : "✓"}</span> {headline(status)}
          </p>

          {err && <div className="cmp-err" role="alert">{err}</div>}

          <dl className="asst-facts">
            <div>
              <dt>This week</dt>
              <dd>{status.plannedThisWeek} {status.plannedThisWeek === 1 ? "post" : "posts"} planned</dd>
            </div>
            <div>
              <dt>Next publish</dt>
              <dd>
                {status.nextPublishAt
                  ? describeWhen(status.nextPublishAt)
                  : status.paused ? "Nothing while paused" : "Nothing scheduled yet"}
              </dd>
            </div>
            <div>
              <dt>Needs your attention</dt>
              <dd className={status.awaitingApproval ? "asst-need" : ""}>
                {status.awaitingApproval === 0
                  ? "Nothing right now"
                  : `${status.awaitingApproval} ${status.awaitingApproval === 1 ? "approval" : "approvals"}`}
              </dd>
            </div>
          </dl>

          <div className="asst-actions">
            <a className="asst-cta" href="/studio/social">Review</a>
            <button className="asst-secondary" disabled={saving} onClick={togglePause}>
              {status.paused ? "Resume marketing" : "Pause marketing"}
            </button>
          </div>

          {/* Honest about the platforms that cannot publish yet. Said once, quietly, rather
              than repeated as a warning on every screen. */}
          {early.length > 0 && (
            <p className="asst-note">
              Populr is writing for {early.map((p) => PLATFORM_LABEL[p]).join(" and ")}. Publishing there opens in
              early access — you&apos;ll be told the day it does.
            </p>
          )}

          <div className="asst-advanced">
            <button className="asst-disclose" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((v) => !v)}>
              Advanced
            </button>
            {showAdvanced && (
              <div className="asst-adv-body">
                <label>
                  <span>Posting limit</span>
                  <em>No more than {advanced.maxPostsPerWeek} posts a week on any platform</em>
                </label>
                <label>
                  <span>Approval reminders</span>
                  <em>Remind me if something waits more than {advanced.approvalReminderHours} hours</em>
                </label>
                <label>
                  <span>Brand safety</span>
                  <em>{advanced.blockedTerms.length ? `${advanced.blockedTerms.length} blocked words` : "No blocked words yet"}</em>
                </label>
                <label>
                  <span>Platform preferences</span>
                  <em>{platforms.map((p) => PLATFORM_LABEL[p]).join(", ") || "None chosen"}</em>
                </label>
                <button className="asst-secondary" onClick={() => { setEditing(true); setStep(0); }}>
                  Change my answers
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  // ---------------------------------------------------------------- Setup
  const canContinue =
    (step === 0 && cadence) || (step === 1 && platforms.length > 0) ||
    (step === 2 && control) || (step === 3 && goal);

  const next = () => (step === LAST_STEP ? finish() : setStep((s) => (s + 1) as Step));

  return (
    <div className="asst-wrap">
      <section className="asst-setup">
        <p className="asst-step">{step + 1} of 4</p>

        {step === 0 && (
          <>
            <h1>How often should Populr post?</h1>
            <div className="asst-choices">
              {CADENCES.map((c) => (
                <button key={c} className={"asst-choice" + (cadence === c ? " on" : "")}
                  aria-pressed={cadence === c} onClick={() => setCadence(c)}>
                  <strong>{CADENCE_META[c].label}</strong>
                  <em>{CADENCE_META[c].detail}</em>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1>Where should Populr post?</h1>
            <div className="asst-choices">
              {PLATFORM_CHOICES.map((p) => {
                const on = platforms.includes(p.platform);
                return (
                  <button key={p.platform} className={"asst-choice" + (on ? " on" : "")}
                    aria-pressed={on}
                    onClick={() => setPlatforms((all) => on ? all.filter((x) => x !== p.platform) : [...all, p.platform])}>
                    <strong>
                      {p.label}
                      <span className={"asst-ready asst-ready-" + p.readiness}>
                        {p.readiness === "ready" ? "Ready" : "Early access"}
                      </span>
                    </strong>
                    {/* The expectation is shown once selected, so choosing an early-access
                        platform never leaves someone guessing what they just signed up for. */}
                    {on && <em>{p.expectation}</em>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>How much do you want to review?</h1>
            <div className="asst-choices">
              {CONTROL_LEVELS.map((c) => (
                <button key={c} className={"asst-choice" + (control === c ? " on" : "")}
                  aria-pressed={control === c} onClick={() => setControl(c)}>
                  <strong>{CONTROL_META[c].label}</strong>
                  <em>{CONTROL_META[c].detail}</em>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>What are you aiming for?</h1>
            <div className="asst-choices">
              {GOALS.map((g) => (
                <button key={g} className={"asst-choice" + (goal === g ? " on" : "")}
                  aria-pressed={goal === g} onClick={() => setGoal(g)}>
                  <strong>{GOAL_META[g].label}</strong>
                  <em>{GOAL_META[g].detail}</em>
                </button>
              ))}
            </div>
          </>
        )}

        {err && <div className="cmp-err" role="alert">{err}</div>}

        <div className="asst-nav">
          {step > 0 && <button className="asst-back" onClick={() => setStep((s) => (s - 1) as Step)}>Back</button>}
          <button className="asst-cta" disabled={!canContinue || saving} onClick={next}>
            {saving ? "Starting…" : step === LAST_STEP ? "Start my marketing" : "Continue"}
          </button>
        </div>
      </section>
    </div>
  );
}
