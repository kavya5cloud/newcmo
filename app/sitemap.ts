import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, url } from "@/lib/seo";

// Next generates /sitemap.xml from this. Listed routes are the public ones only — the
// signed-in product and the admin screens are excluded on purpose, see lib/seo.ts.

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((r) => ({
    url: url(r.path),
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
