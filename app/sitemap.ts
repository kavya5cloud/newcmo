import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, SITE_URL, url } from "@/lib/seo";

// Next generates /sitemap.xml from this. Listed routes are the public ones only — the
// signed-in product and the admin screens are excluded on purpose, see lib/seo.ts.

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((r) => ({
    // Next renders the home canonical as the bare origin, with no trailing slash. The
    // sitemap has to say the same thing: listing "/" while the page declares itself
    // canonical without it is two URLs for one page, which is exactly what Search Console
    // reports as a duplicate.
    url: r.path === "/" ? SITE_URL : url(r.path),
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
