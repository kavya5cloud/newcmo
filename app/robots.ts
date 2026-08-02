import type { MetadataRoute } from "next";
import { DISALLOWED, url } from "@/lib/seo";

// Next generates /robots.txt from this.
//
// robots.txt controls crawling, not indexing — a disallowed URL can still appear in results
// if something links to it. The signed-in routes also carry `robots: noindex` in their
// metadata, which is what actually keeps them out.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: DISALLOWED }],
    sitemap: url("/sitemap.xml"),
    host: url("/").replace(/\/$/, ""),
  };
}
