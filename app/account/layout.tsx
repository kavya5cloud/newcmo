import type { Metadata } from "next";

// Account settings — signed-in product surface. robots.txt asks crawlers not to fetch it, but
// robots.txt only controls crawling: a disallowed URL can still be indexed from an
// inbound link. noindex is what actually keeps it out of results.

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
