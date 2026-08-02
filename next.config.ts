import type { NextConfig } from "next";
import { CANONICAL_HOST, WWW_HOST } from "./lib/seo";

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
  // api.producthunt.com serves the Product Hunt featured badge on the landing page.
  "img-src 'self' data: blob: https://api.producthunt.com",
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
      // Canonical host is https://trypopulr.in. www must redirect rather than serve the
      // same pages: two hosts answering identically is duplicate content, and it splits
      // link signals between them.
      //
      // Vercel's domain settings can also do this, and if configured there it fires first
      // at the edge. This is here so the guarantee travels with the code and holds on any
      // host — belt and braces, not a duplicate: whichever runs first, the result is the
      // same 308 to the same place.
      {
        source: "/:path*",
        has: [{ type: "host", value: WWW_HOST }],
        destination: `${CANONICAL_HOST}/:path*`,
        permanent: true,
      },
      // http → https. Vercel terminates TLS and already redirects, so in practice this
      // only matters on a host that does not. `upgrade-insecure-requests` in the CSP
      // covers subresources; this covers the document itself.
      {
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-proto", value: "http" }],
        destination: `${CANONICAL_HOST}/:path*`,
        permanent: true,
      },

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
