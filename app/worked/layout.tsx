import type { Metadata } from "next";

// Client page, so metadata lives here — see app/early-access/layout.tsx.

export const metadata: Metadata = {
  title: "What actually worked",
  description:
    "The marketing actions Populr took, and what each one actually did — measured against real outcomes rather than activity counts.",
  alternates: { canonical: "/worked" },
  openGraph: {
    title: "What actually worked — Populr",
    description:
      "The marketing actions Populr took, and what each one actually did — measured against real outcomes.",
    url: "/worked",
    type: "website",
  },
};

export default function WorkedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
