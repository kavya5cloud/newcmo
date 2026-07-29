"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

// Creative Studio navigation.
//
// This was seventeen links drawn with Unicode glyphs — seventeen choices to answer "I want
// to write a post", which is the one thing people come here to do. Several pointed at
// pages that could not act on them.
//
// It is now four places where work happens, and four you look at. Nothing was removed:
// every route still exists and is still reachable. The asset categories moved inside
// Create, where they belong, because "Videos" is a kind of thing you make, not a place you
// go.

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke} aria-hidden="true">{children}</svg>
);

type Item = { href: string; label: string; icon: ReactNode; match?: (p: string) => boolean };

/** Where work happens. */
const PRIMARY: Item[] = [
  {
    href: "/studio", label: "Create",
    icon: svg(<><path d="M4 20l1.2-4.2L16.4 4.6a2.05 2.05 0 0 1 2.9 2.9L8.2 18.8 4 20z" /><path d="M14.5 6.5l3 3" /></>),
    // Create owns the asset categories now, so their routes keep it highlighted.
    match: (p) => p === "/studio" || /^\/studio\/(documents|ads|videos|images|motion|ugc|blitz)$/.test(p),
  },
  {
    href: "/studio/library", label: "Library",
    icon: svg(<><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></>),
  },
  {
    href: "/studio/social", label: "Publishing",
    icon: svg(<><path d="M4 4h16v12H5.2L4 18z" /><path d="M8 9h8M8 12h5" /></>),
    match: (p) => p === "/studio/social" || p === "/studio/publishing",
  },
  {
    href: "/studio/launch", label: "Launch",
    icon: svg(<><path d="M13.5 3.5C17 4.5 19.5 7 20.5 10.5c.3 1-.2 1.7-1 2L14 15l-5-5 2.5-5.5c.3-.8 1-1.3 2-1Z" /><path d="M9 15l-3 3M5 13l-1.5 4.5L8 16" /><circle cx="15" cy="9" r="1.4" /></>),
  },
];

/** What you look at rather than work in. */
const SECONDARY: Item[] = [
  { href: "/studio/market", label: "Market", icon: svg(<><path d="M4 19V5M4 19h16" /><path d="M8 16l4-6 3 3 5-7" /></>) },
  { href: "/studio/learning", label: "Performance", icon: svg(<><path d="M12 3l8 4-8 4-8-4 8-4Z" /><path d="M6 10v4c0 1.5 2.7 3 6 3s6-1.5 6-3v-4" /></>) },
  { href: "/studio/jobs", label: "Activity", icon: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>) },
  { href: "/studio/integrations", label: "Connections", icon: svg(<><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></>) },
];

function NavLink({ item, path }: { item: Item; path: string }) {
  const active = item.match ? item.match(path) : path === item.href;
  return (
    <Link href={item.href} className={"st-link" + (active ? " on" : "")} aria-current={active ? "page" : undefined}>
      <span className="st-link-ic">{item.icon}</span>
      <span className="st-link-label">{item.label}</span>
    </Link>
  );
}

export default function StudioNav() {
  const path = usePathname();
  return (
    <nav className="st-nav" aria-label="Creative Studio">
      <Link href="/studio" className="st-brand">
        <span className="st-brand-word">Populr<span className="st-brand-acc">.</span></span>
        <span className="st-brand-name">Studio</span>
      </Link>

      <div className="st-links">
        {PRIMARY.map((i) => <NavLink key={i.href} item={i} path={path} />)}
      </div>

      <div className="st-links st-links-2">
        {SECONDARY.map((i) => <NavLink key={i.href} item={i} path={path} />)}
      </div>

      <Link href="/app" className="st-back">
        <span className="st-link-ic">{svg(<path d="M15 5l-7 7 7 7" />)}</span>
        <span className="st-link-label">Back to app</span>
      </Link>
    </nav>
  );
}
