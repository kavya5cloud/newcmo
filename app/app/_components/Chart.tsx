"use client";

import { esc } from "../_lib/html";


/* ---------- SVG traffic chart (generic: primary = filled line, secondary = dashed) ---------- */
export function Chart({ labels, primary, secondary }: { labels: string[]; primary: number[]; secondary: number[] }) {
  const W = 560, H = 150, P = 10;
  const max = Math.max(...primary, 1) * 1.15;
  const denom = Math.max(primary.length - 1, 1);
  const pt = (arr: number[], i: number): [number, number] => [P + (i * (W - 2 * P)) / denom, H - P - ((arr[i] || 0) / max) * (H - 2 * P)];
  const line = (arr: number[]) => arr.map((_, i) => pt(arr, i).map((n) => n.toFixed(1)).join(",")).join(" ");
  const area = `${P},${H - P} ${line(primary)} ${W - P},${H - P}`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Traffic over time">
        <polygon points={area} fill="rgba(205,166,242,.10)" />
        <polyline points={line(primary)} fill="none" stroke="#CDA6F2" strokeWidth="2" />
        <polyline points={line(secondary)} fill="none" stroke="#55565E" strokeWidth="1.5" strokeDasharray="4 4" />
        {primary.map((_, i) => { const [x, y] = pt(primary, i); return <circle key={i} cx={x} cy={y} r="2.6" fill="#CDA6F2" />; })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'Geist Mono',monospace", fontSize: "9.5px", color: "var(--faint)", padding: "0 2px" }}>
        {labels.map((l, i) => <span key={i}>{l}</span>)}
      </div>
    </>
  );
}
