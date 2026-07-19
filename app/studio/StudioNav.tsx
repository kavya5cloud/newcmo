"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { CREATIVE_CATEGORIES, CATEGORY_META, type CreativeCategory } from "@/lib/creative/taxonomy";

// Creative Studio navigation. Reads the category taxonomy so nav and content never
// drift. Polished product-shell sidebar (icon + label rows, filled active state) on
// desktop; a horizontal scroller on mobile.

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" {...stroke} aria-hidden="true">{children}</svg>
);

const ICONS: Record<CreativeCategory, ReactNode> = {
  launch: svg(<><path d="M13.5 3.5C17 4.5 19.5 7 20.5 10.5c.3 1-.2 1.7-1 2L14 15l-5-5 2.5-5.5c.3-.8 1-1.3 2-1Z" /><path d="M9 15l-3 3M5 13l-1.5 4.5L8 16" /><circle cx="15" cy="9" r="1.4" /></>),
  videos: svg(<><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></>),
  ugc: svg(<><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18h2" /></>),
  motion: svg(<><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>),
  images: svg(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="8.5" cy="9.5" r="1.6" /><path d="M21 16l-5-5-8 8" /></>),
  documents: svg(<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>),
  ads: svg(<><path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M17 9a4 4 0 0 1 0 6" /></>),
  library: svg(<><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /><path d="M6.5 8h0M17.5 8h0" /></>),
};

export default function StudioNav() {
  const path = usePathname();
  return (
    <nav className="st-nav" aria-label="Creative Studio sections">
      <Link href="/studio" className="st-brand">
        <span className="st-brand-word">Populr<span className="st-brand-acc">.</span></span>
        <span className="st-brand-name">Creative Studio</span>
      </Link>

      <div className="st-navlabel">Sections</div>
      <div className="st-links">
        {CREATIVE_CATEGORIES.map((c) => {
          const href = `/studio/${c}`;
          const active = path === href;
          const m = CATEGORY_META[c];
          return (
            <Link key={c} href={href} className={"st-link" + (active ? " on" : "")} aria-current={active ? "page" : undefined}>
              <span className="st-link-ic">{ICONS[c]}</span>
              <span className="st-link-label">{m.label}</span>
            </Link>
          );
        })}
      </div>

      <Link href="/app" className="st-back">
        <span className="st-link-ic">{svg(<path d="M15 5l-7 7 7 7" />)}</span>
        <span className="st-link-label">Back to app</span>
      </Link>
    </nav>
  );
}
