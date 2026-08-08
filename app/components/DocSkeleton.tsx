"use client";

import { useEffect, useState } from "react";
import Icon from "./Icon";
import { STAGE_SEQUENCES } from "./ai-processing/stages";

// What fills the panel while a deliverable is being written.
//
// Generation takes as long as it takes — the model is not going to get faster because the UI
// asks. What was missing was any evidence the press had landed: the old behaviour changed one
// button's caption to "…" and left the rest of the screen identical, which reads as a dead
// click, and a dead click gets pressed again.
//
// So: shaped placeholder lines where the text will appear, the current step named in plain
// language, and an elapsed counter. The counter is the honest part — a spinner with no clock
// gives no way to tell "working" from "hung", and after fifteen seconds people want to know
// which one they are looking at.

const STEPS = STAGE_SEQUENCES.document ?? STAGE_SEQUENCES.general;

/** Line widths, in percent. Uneven on purpose — even bars read as a loading bar, not text. */
const LINES = [96, 88, 72, 94, 81, 60];

export default function DocSkeleton() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(t);
  }, []);

  // Advance roughly every four seconds but never past the last step: claiming "finalizing"
  // and then sitting there for another twenty seconds is worse than saying nothing.
  const step = STEPS[Math.min(Math.floor(elapsed / 4), STEPS.length - 1)];
  const slow = elapsed >= 20;

  return (
    <div className="docskel" role="status" aria-live="polite">
      <div className="docskel-head">
        <span className="docskel-ic" aria-hidden="true"><Icon name={step.icon} size={15} /></span>
        <span className="docskel-step">
          <span className="docskel-title">{step.title}</span>
          <span className="docskel-hint">{slow ? "Taking longer than usual — still working" : step.hint}</span>
        </span>
        <span className="docskel-time" aria-hidden="true">{elapsed}s</span>
      </div>

      <div className="docskel-lines" aria-hidden="true">
        {LINES.map((w, i) => (
          <span key={i} className="docskel-line" style={{ width: w + "%", animationDelay: i * 90 + "ms" }} />
        ))}
      </div>
    </div>
  );
}
