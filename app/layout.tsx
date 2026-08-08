import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/react";
import EarlyAccessBanner from "./components/EarlyAccessBanner";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/seo";
import JsonLd from "./components/JsonLd";
import "./globals.css";

export const metadata: Metadata = {
  // Without metadataBase, every relative canonical and OG image URL resolves against
  // localhost in development and is emitted relative in production, which crawlers and
  // link unfurlers both ignore.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Populr — your AI CMO",
    // Sub-pages set only their own name; the brand is appended once, here, so no page ends
    // up with the brand twice or not at all.
    template: `%s — ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Self-referencing canonical on the home page. Sub-pages override with their own.
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: "Populr — your AI CMO",
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Populr — your AI CMO",
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // Let Google use a full-length text snippet and a large image rather than truncating.
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  // No `icons` block on purpose.
  //
  // It used to point every rel at "/icon.svg?v=4", which overrode Next's file conventions and
  // left two gaps. Browsers request /favicon.ico regardless of what the page declares, and
  // ours 404'd to an HTML error page — so they kept showing whatever was already cached,
  // which is why /app appeared to have the old mark. And iOS ignores SVG for home-screen
  // icons, so a bookmarked dashboard got a grey placeholder.
  //
  // app/favicon.ico, app/icon.svg and app/apple-icon.png are now picked up automatically,
  // and Next appends its own content hash — so the next time the mark changes, the new one
  // actually reaches people instead of needing a hand-bumped ?v=5.
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <JsonLd />
        <EarlyAccessBanner />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
