"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Draggable column widths for the dashboard.
//
// The four columns were fixed at 250 / 1fr / 300 / 330. Those numbers suit the person who
// wrote them: someone reading long company copy wants the first column wider, someone living
// in the chat wants the last one wider, and on a 13" screen nobody wants all four at once.
//
// Three separators, one between each pair. The second column is never sized directly — it
// stays 1fr and absorbs whatever the others give up, which is what keeps the row exactly as
// wide as the window no matter how the handles are dragged. Sizing all four independently is
// the version that drifts and leaves a gap or a scrollbar.
//
// Handles are positioned from measured DOM rects rather than computed from widths plus gap
// plus padding. The arithmetic version is correct until someone changes the gap in CSS, and
// then it is silently wrong.

const KEY = "populr:cols:v1";
/** Below this the layout stacks into mobile tabs and there is nothing to drag. */
const MIN_VIEWPORT = 1100;
const MIN = { left: 190, agents: 220, chat: 250 };
const MAX = { left: 460, agents: 520, chat: 560 };
const DEFAULTS: Widths = { left: 250, agents: 300, chat: 330 };

type Widths = { left: number; agents: number; chat: number };
type Edge = keyof Widths;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function load(): Widths {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<Widths>;
    // Clamped on the way in: a stored width from a wider screen, or from an older set of
    // limits, must not be able to push a column off the layout.
    return {
      left: clamp(Number(p.left) || DEFAULTS.left, MIN.left, MAX.left),
      agents: clamp(Number(p.agents) || DEFAULTS.agents, MIN.agents, MAX.agents),
      chat: clamp(Number(p.chat) || DEFAULTS.chat, MIN.chat, MAX.chat),
    };
  } catch {
    return DEFAULTS;
  }
}

export default function ResizableDash({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Server and first client render must agree, so the stored widths are read in an effect
  // rather than in the initialiser. Hydrating with localStorage is the classic mismatch.
  const [w, setW] = useState<Widths>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [offsets, setOffsets] = useState<number[]>([]);
  const drag = useRef<{ edge: Edge; startX: number; startW: number } | null>(null);

  useEffect(() => { setW(load()); setReady(true); }, []);

  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(w)); } catch { /* private mode */ }
  }, [w, ready]);

  // Where the handles sit: the middle of each gap, measured. useLayoutEffect so they are
  // placed in the same frame the columns move, or they visibly lag the drag.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const cols = [...el.children].filter((c) => c.classList.contains("col")) as HTMLElement[];
    if (cols.length < 4) return;
    const base = el.getBoundingClientRect().left;
    setOffsets([0, 1, 2].map((i) => {
      const a = cols[i].getBoundingClientRect();
      const b = cols[i + 1].getBoundingClientRect();
      return (a.right + b.left) / 2 - base;
    }));
  }, []);

  useLayoutEffect(() => { measure(); }, [measure, w, ready]);
  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  const onDown = (edge: Edge) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    drag.current = { edge, startX: e.clientX, startW: w[edge] };
    // Capture on the handle: the pointer routinely outruns a 6px target mid-drag, and
    // without this the drag stops the moment it does.
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    // The left column grows as the pointer moves right; the two on the right grow as it
    // moves left, because their edge is on their left side.
    const delta = d.edge === "left" ? e.clientX - d.startX : d.startX - e.clientX;
    setW((p) => ({ ...p, [d.edge]: clamp(d.startW + delta, MIN[d.edge], MAX[d.edge]) }));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  // A separator that only responds to a pointer is unusable without a mouse. Arrows nudge,
  // Home restores the default — the same affordances a native split pane has.
  const onKey = (edge: Edge) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    let delta = 0;
    if (e.key === "ArrowLeft") delta = edge === "left" ? -step : step;
    else if (e.key === "ArrowRight") delta = edge === "left" ? step : -step;
    else if (e.key === "Home") { e.preventDefault(); setW((p) => ({ ...p, [edge]: DEFAULTS[edge] })); return; }
    else return;
    e.preventDefault();
    setW((p) => ({ ...p, [edge]: clamp(p[edge] + delta, MIN[edge], MAX[edge]) }));
  };

  const EDGES: { edge: Edge; label: string }[] = [
    { edge: "left", label: "Resize the company column" },
    { edge: "agents", label: "Resize the agents column" },
    { edge: "chat", label: "Resize the chat column" },
  ];

  return (
    <div
      ref={ref}
      className="dash"
      style={{
        gridTemplateColumns:
          `${w.left}px minmax(340px,1fr) ${w.agents}px ${w.chat}px`,
      }}
    >
      {children}
      {ready && offsets.length === 3 && EDGES.map(({ edge, label }, i) => (
        <div
          key={edge}
          className="colgrip"
          style={{ left: offsets[i] }}
          role="separator"
          aria-orientation="vertical"
          aria-label={label}
          aria-valuenow={w[edge]}
          aria-valuemin={MIN[edge]}
          aria-valuemax={MAX[edge]}
          tabIndex={0}
          onPointerDown={onDown(edge)}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKey(edge)}
          onDoubleClick={() => setW((p) => ({ ...p, [edge]: DEFAULTS[edge] }))}
        />
      ))}
    </div>
  );
}

/** Exported for the test that keeps the stored widths inside the limits. */
export { clamp, MIN, MAX, DEFAULTS, KEY, MIN_VIEWPORT };
export type { Widths };
