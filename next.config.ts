import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy. The app previously shipped no CSP at all, so nothing
// constrained script/style/connect sources.
//
// script-src: Next.js inlines its bootstrap/hydration scripts, so 'unsafe-inline' is
// required unless we move to per-request nonces (which needs middleware). 'unsafe-eval'
// is DEV ONLY — the dev server's HMR evaluates modules with eval, while the production
// bundle contains none (verified against .next/static), so production stays strict.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // The Supa Launch badge is served from their R2 bucket. A badge host has to be named
  // here or the image is blocked with no visible cause — the page just renders a gap.
  "img-src 'self' data: blob: https://r2.direasy-multi-tenant.focusapps.app",
  "font-src 'self' https://fonts.gstatic.com data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "connect-src 'self' https://vitals.vercel-insights.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async redirects() {
    return [
      // NO host or protocol redirects here. They belong to the platform, and duplicating
      // them in the app caused an outage.
      //
      // A previous version redirected www → non-www from here, reasoning that it was
      // harmless insurance on top of Vercel's own domain redirect. That was wrong. Vercel's
      // primary domain was www, so it redirected non-www → www while this redirected
      // www → non-www, and every URL on the site bounced between the two until the browser
      // gave up. "Belt and braces" only holds when both point the same way; two redirects
      // pointing at each other is not redundancy, it is a loop.
      //
      // The canonical host is declared once, in lib/seo.ts, and enforced in exactly one
      // place: Vercel's domain settings. To switch to non-www, change it there — nothing
      // here needs to know.
      { source: "/privacy-policy", destination: "/privacy", permanent: true },
      { source: "/terms-of-service", destination: "/terms", permanent: true },
      { source: "/terms-and-conditions", destination: "/terms", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
