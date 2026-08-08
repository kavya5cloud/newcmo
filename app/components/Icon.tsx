// The one icon set.
//
// Every pictorial mark in the product comes from here. Before this, stages and status rows
// used emoji — which look like a different product on every platform (Apple's 🧠 is pink and
// glossy, Windows' is flat grey, Android's is another thing again), sit on a baseline that
// never quite aligns with text, and cannot take the accent colour. They also carry a tone
// this product does not want: 🎉 on a completed job reads as a party, not a result.
//
// These are stroke drawings on a 24-unit grid in `currentColor`, so they inherit size and
// colour from whatever they sit in and match the icons already drawn inline in the
// dashboard (same viewBox, same 1.7 stroke, same round caps).

export type IconName =
  // work stages
  | "brain" | "chart" | "target" | "sparkle" | "trend" | "rocket" | "calendar"
  | "palette" | "megaphone" | "library" | "clapper" | "cast" | "camera"
  | "search" | "doc" | "pen" | "queue" | "package" | "clock"
  // status
  | "check" | "check-circle" | "close" | "circle" | "pause" | "gear"
  // controls
  | "plus" | "minus";

const PATHS: Record<IconName, React.ReactNode> = {
  brain: <><path d="M12 5.5a2.8 2.8 0 0 0-5.2-1.4A2.6 2.6 0 0 0 4 8.2a2.7 2.7 0 0 0-.4 4.6A2.8 2.8 0 0 0 5.4 17a2.7 2.7 0 0 0 4.3 2.2A2.4 2.4 0 0 0 12 20.5z" /><path d="M12 5.5a2.8 2.8 0 0 1 5.2-1.4A2.6 2.6 0 0 1 20 8.2a2.7 2.7 0 0 1 .4 4.6A2.8 2.8 0 0 1 18.6 17a2.7 2.7 0 0 1-4.3 2.2A2.4 2.4 0 0 1 12 20.5z" /><path d="M12 5.5v15" /></>,
  chart: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8.5 20v-6.5" /><path d="M13 20V8.5" /><path d="M17.5 20v-9" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.2" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  sparkle: <><path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" /><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" /></>,
  trend: <><path d="M4 16.5l5-5 3.5 3.5L20 8" /><path d="M15.5 8H20v4.5" /></>,
  rocket: <><path d="M13.8 4.6c2.9-1.2 5.6-1.2 5.6-1.2s0 2.7-1.2 5.6c-1 2.4-3.4 5-5.6 6.6L9.4 13a26 26 0 0 1 4.4-8.4z" /><circle cx="14.8" cy="9.2" r="1.6" /><path d="M9.4 13l-2.6.6-1 3.2 3.2-1 .6-2.6" /><path d="M7 17l-2.5 2.5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 9.8h17" /><path d="M8 3.5v3M16 3.5v3" /><path d="M7.8 13.5h2.4M13.8 13.5h2.4M7.8 17h2.4" /></>,
  palette: <><path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.9-1.8h1.4a4.3 4.3 0 0 0 4.3-4.3c0-3.7-3.8-6.7-8.5-6.7z" /><circle cx="8" cy="10.2" r="1.1" fill="currentColor" stroke="none" /><circle cx="11.8" cy="7.6" r="1.1" fill="currentColor" stroke="none" /><circle cx="15.8" cy="9.4" r="1.1" fill="currentColor" stroke="none" /></>,
  megaphone: <><path d="M4 10.2v3.6a1.8 1.8 0 0 0 1.8 1.8h1.4L18 20V4L7.2 8.4H5.8A1.8 1.8 0 0 0 4 10.2z" /><path d="M18 8.6a3.4 3.4 0 0 1 0 6.8" /><path d="M7.4 15.8l1 4.2h2.8l-.8-4.2" /></>,
  library: <><path d="M4.5 5.2A1.7 1.7 0 0 1 6.2 3.5H10v17H6.2a1.7 1.7 0 0 1-1.7-1.7z" /><path d="M10 3.5h3.8a1.7 1.7 0 0 1 1.7 1.7v13.6a1.7 1.7 0 0 1-1.7 1.7H10z" /><path d="M17.4 5l2.1 13.4" /></>,
  clapper: <><rect x="3.5" y="9" width="17" height="11.5" rx="2" /><path d="M3.8 9l1.4-4.3 15.1 2.1-.5 2.2" /><path d="M8.6 4.4l-1 4.4M13.2 5.1l-1 4.3" /></>,
  cast: <><circle cx="8.6" cy="9" r="4" /><circle cx="15.4" cy="9" r="4" /><path d="M3.5 20.5a5.1 5.1 0 0 1 10.2 0" /><path d="M14.3 15.8a5.1 5.1 0 0 1 6.2 4.7" /></>,
  camera: <><rect x="2.8" y="6.5" width="12.5" height="11" rx="2.2" /><path d="M15.3 11.2l5.9-3.2v8.2l-5.9-3.2z" /></>,
  search: <><circle cx="11" cy="11" r="6.4" /><path d="M15.8 15.8L20.5 20.5" /></>,
  doc: <><path d="M6 3.5h7.5L19 9v11.5H6z" /><path d="M13.5 3.5V9H19" /><path d="M8.8 13h7M8.8 16.4h4.6" /></>,
  pen: <><path d="M4 20l1-4.2L16.2 4.6a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19 4 20z" /><path d="M14.8 6l3.2 3.2" /></>,
  queue: <><path d="M12 3.2l8 4.4v8.8l-8 4.4-8-4.4V7.6z" /><path d="M4 7.6l8 4.4 8-4.4" /><path d="M12 12v8.8" /></>,
  package: <><rect x="3.5" y="8.5" width="17" height="12" rx="2" /><path d="M3.5 12.6h17" /><path d="M12 8.5v12" /><path d="M8.4 8.5a2.4 2.4 0 1 1 1.8-4 2.9 2.9 0 0 1 1.8 4M15.6 8.5a2.4 2.4 0 1 0-1.8-4 2.9 2.9 0 0 0-1.8 4" /></>,
  clock: <><circle cx="12" cy="12" r="8.4" /><path d="M12 7.2V12l3.2 2" /></>,
  check: <><path d="M5 12.8l4.4 4.4L19 7.6" /></>,
  "check-circle": <><circle cx="12" cy="12" r="8.4" /><path d="M8.2 12.3l2.6 2.6 5-5.2" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  circle: <><circle cx="12" cy="12" r="7.4" /></>,
  pause: <><path d="M9.4 5.5v13M14.6 5.5v13" /></>,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8l1.1 2.3 2.5-.6.4 2.5 2.4.9-1.2 2.3 1.6 2-2 1.6.5 2.5-2.5.3-.9 2.4-2.3-1.1-2 1.6-1.4-2.1-2.5.2-.2-2.5-2.4-.8.9-2.4-1.7-1.9 2-1.5-.3-2.5 2.5-.4.8-2.4z" /></>,
  plus: <><path d="M12 5.5v13M5.5 12h13" /></>,
  minus: <><path d="M5.5 12h13" /></>,
};

export default function Icon({
  name,
  size = 16,
  className,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  /** Give this only when the icon is the sole carrier of meaning. Decorative icons beside a
      text label should stay unlabelled, or a screen reader reads the same thing twice. */
  title?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Every name the set defines — used by the test that keeps stages honest. */
export const ICON_NAMES = Object.keys(PATHS) as IconName[];
