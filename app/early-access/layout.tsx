import type { Metadata } from "next";

// page.tsx is a client component, so it cannot export metadata. This layout carries it —
// without it the page inherited the home page's title and had no canonical of its own,
// which reads to a crawler as a duplicate of the home page.

export const metadata: Metadata = {
  title: "Early access",
  description:
    "Join the Populr early access programme. Get your marketing run daily by AI agents, and help shape what ships next.",
  alternates: { canonical: "/early-access" },
  openGraph: {
    title: "Early access — Populr",
    description:
      "Join the Populr early access programme. Get your marketing run daily by AI agents, and help shape what ships next.",
    url: "/early-access",
    type: "website",
  },
};

export default function EarlyAccessLayout({ children }: { children: React.ReactNode }) {
  return children;
}
