"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { SHOW_CONTENT_ENGINE } from "@/lib/flags";

// Five places, named after what you want rather than what runs.
//
// This was eight links, and before that seventeen. The count was never the real problem —
// the names were. "Market Intelligence", "Learning Engine" and "Creative Studio" are what
// the subsystems are called in the code, and every one of them made the reader translate
// before they could choose.
//
// Campaigns, the AI team, market intelligence, the learning engine and automation are all
// still here and still running. They are implementation now, not navigation: things Populr
// does, not places you visit. Every route below still resolves, and so do the ones that
// left the list.

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke} aria-hidden="true">{children}</svg>
);

type Item = { href: string; label: string; icon: ReactNode; match?: (p: string) => boolean };

const NAV: Item[] = [
  {
    href: "/app", label: "Home",
    icon: svg(<><path d="M4 11l8-6 8 6" /><path d="M6 10v9h12v-9" /></>),
  },
  // Create only appears when there is something behind it. A nav item that redirects to the
  // page you came from is worse than one that isn't there.
  ...(SHOW_CONTENT_ENGINE ? [{
    href: "/studio", label: "Create",
    icon: svg(<><path d="M4 20l1.2-4.2L16.4 4.6a2.05 2.05 0 0 1 2.9 2.9L8.2 18.8 4 20z" /><path d="M14.5 6.5l3 3" /></>),
    match: (p: string) => p === "/studio" || /^\/studio\/(documents|ads|videos|images|motion|ugc|blitz|library)$/.test(p),
  }] : []),
  {
    href: "/studio/social", label: "Publishing",
    icon: svg(<><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></>),
    match: (p) => p === "/studio/social" || p === "/studio/publishing" || p === "/studio/launch",
  },
  {
    href: "/studio/learning", label: "Results",
    icon: svg(<><path d="M4 19V5M4 19h16" /><path d="M8 16l4-6 3 3 5-7" /></>),
    // Opportunities and performance are both "how is it going", so they live together.
    match: (p) => p === "/studio/learning" || p === "/studio/market" || p === "/worked",
  },
  {
    href: "/studio/integrations", label: "Settings",
    icon: svg(<><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z" /></>),
    match: (p) => p === "/studio/integrations" || p === "/studio/jobs" || p === "/account",
  },
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
    <nav className="st-nav" aria-label="Populr">
      <Link href="/app" className="st-brand">
        <span className="st-brand-word">Populr<span className="st-brand-acc">.</span></span>
      </Link>

      <div className="st-links">
        {NAV.map((i) => <NavLink key={i.href} item={i} path={path} />)}
      </div>
    </nav>
  );
}
