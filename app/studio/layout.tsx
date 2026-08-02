import type { Metadata } from "next";
import StudioNav from "./StudioNav";

export const metadata: Metadata = {
  title: "Creative Studio — Populr",
  description: "Plan, generate and approve complete product launches — videos, UGC, motion, and more.",
  // Signed-in surface. robots.txt asks crawlers not to fetch /studio, but that only governs
  // crawling — noindex is what keeps it out of results if something links to it.
  robots: { index: false, follow: false, nocache: true },
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="studio">
      <StudioNav />
      <main className="st-main">{children}</main>
    </div>
  );
}
