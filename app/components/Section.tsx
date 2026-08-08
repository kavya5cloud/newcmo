"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon";

// A section that can be folded away.
//
// The dashboard columns stack a lot of panels, and on a phone that means a long scroll past
// things you are not looking at to reach the one you are. The header is the control: a plus
// when folded, a minus when open — the two states name each other, so there is nothing to
// learn.
//
// Two details that matter more than the animation:
//
//   The whole header is one <button>, not a small icon target. Tapping a heading to fold it
//   is the gesture people already try, and a 12px plus sign is not a touch target.
//
//   Folded sections are remembered per id in localStorage. Someone who folds Competitors
//   away is saying they do not want it; reopening it on every reload argues with them.
//   Content stays in the DOM with `hidden` so in-page find still reaches it.

const STORE_KEY = "populr.folded";

function readFolded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") as Record<string, boolean>;
  } catch {
    return {};   // corrupt value is not worth a crash; treat as nothing folded
  }
}

export default function Section({
  id,
  label,
  children,
  defaultFolded = false,
  /** Shown next to the label whether open or folded — a count, a status. */
  meta,
  /** A line of explanation under the heading. Folds away with the body it describes. */
  sub,
  /** Which heading style: the mono column label, or the larger analytics heading. */
  variant = "label",
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  defaultFolded?: boolean;
  meta?: React.ReactNode;
  sub?: React.ReactNode;
  variant?: "label" | "head";
}) {
  const [folded, setFolded] = useState(defaultFolded);

  // Read after mount, not during render: the server has no localStorage, and reading it in
  // an initialiser would make the first client render disagree with the server's HTML.
  useEffect(() => {
    const saved = readFolded()[id];
    if (typeof saved === "boolean") setFolded(saved);
  }, [id]);

  const toggle = useCallback(() => {
    setFolded((was) => {
      const now = !was;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ ...readFolded(), [id]: now }));
      } catch {
        // Private mode, or the quota is full. Folding still works for this session.
      }
      return now;
    });
  }, [id]);

  const bodyId = `sect-${id}`;

  return (
    <div className={"sect" + (folded ? " sect-folded" : "")}>
      <button
        type="button"
        className="sect-toggle"
        onClick={toggle}
        aria-expanded={!folded}
        aria-controls={bodyId}
      >
        <span className={variant === "head" ? "an-h" : "label"}>{label}</span>
        {meta != null && <span className="sect-meta">{meta}</span>}
        <span className="sect-mark" aria-hidden="true">
          <Icon name={folded ? "plus" : "minus"} size={14} />
        </span>
      </button>
      {/* The subtitle explains the body, so it folds with it rather than sitting orphaned
          under a collapsed heading. */}
      {sub != null && !folded && <div className="an-s">{sub}</div>}
      <div className="sect-body" id={bodyId} hidden={folded}>
        {children}
      </div>
    </div>
  );
}
