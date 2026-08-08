// Where a business is growing from.
//
// Not everyone has a website. Someone whose whole presence is an Instagram account is
// still a business worth marketing, so the entry step accepts any of these and
// canonicalises it into something the analyzer can fetch.


/* ---------- growth sources: not everyone has a website ---------- */
export type SourceType = "website" | "instagram" | "linkedin" | "x" | "youtube" | "gbp";

export const SOURCES: { id: SourceType; label: string; placeholder: string }[] = [
  { id: "website", label: "website", placeholder: "https://yourcompany.com" },
  { id: "instagram", label: "instagram", placeholder: "@yourhandle" },
  { id: "linkedin", label: "linkedin", placeholder: "company name or linkedin.com/company/…" },
  { id: "x", label: "x", placeholder: "@yourhandle" },
  { id: "youtube", label: "youtube", placeholder: "@yourchannel" },
  { id: "gbp", label: "google business", placeholder: "business name, city" },
];

export const SOURCE_LABEL: Record<SourceType, string> = {
  website: "website", instagram: "Instagram profile", linkedin: "LinkedIn page",
  x: "X profile", youtube: "YouTube channel", gbp: "Google Business Profile",
};

/** Turn whatever the user typed (handle, name, or URL) into a canonical public URL. */
export function canonicalSource(source: SourceType, raw: string): { url: string; display: string } {
  const t = raw.trim();
  if (source === "website" || /^https?:\/\//.test(t)) {
    let u = t;
    if (!/^https?:\/\//.test(u)) u = "https://" + u;
    return { url: u, display: t.replace(/^https?:\/\//, "") };
  }
  const handle = t.replace(/^@/, "").replace(/\/+$/, "");
  switch (source) {
    case "instagram": return { url: `https://www.instagram.com/${handle}/`, display: "@" + handle };
    case "x": return { url: `https://x.com/${handle}`, display: "@" + handle };
    case "youtube": return { url: `https://www.youtube.com/@${handle}`, display: "@" + handle };
    case "linkedin": return { url: `https://www.linkedin.com/company/${handle.toLowerCase().replace(/\s+/g, "-")}/`, display: t };
    default: return { url: `https://www.google.com/maps/search/${encodeURIComponent(t)}`, display: t };
  }
}
