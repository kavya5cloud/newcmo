import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, SITE_URL, url } from "@/lib/seo";
import { allGuides } from "@/lib/guides";

// Next generates /sitemap.xml from this. Listed routes are the public ones only — the
// signed-in product and the admin screens are excluded on purpose, see lib/seo.ts.

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  // Guides carry their own real modified date rather than "now". A sitemap that claims every
  // page changed today, every day, teaches a crawler to ignore the field entirely.
  const guides: MetadataRoute.Sitemap = allGuides().map((g) => ({
    url: url(`/guides/${g.slug}`),
    lastModified: new Date(g.updated),
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const routes = PUBLIC_ROUTES.map((r) => ({
    // Next renders the home canonical as the bare origin, with no trailing slash. The
    // sitemap has to say the same thing: listing "/" while the page declares itself
    // canonical without it is two URLs for one page, which is exactly what Search Console
    // reports as a duplicate.
    url: r.path === "/" ? SITE_URL : url(r.path),
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));

  return [...routes, ...guides];
}
