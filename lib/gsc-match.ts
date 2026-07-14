/** Match an analyzed website URL to the best GSC property. */

export function hostFromUrl(u: string): string {
  try {
    return new URL(u.startsWith("http") ? u : "https://" + u).hostname.replace(/^www\./, "");
  } catch {
    return u.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export function matchGscSite(sites: string[], analyzedUrl: string): string | null {
  if (!sites.length) return null;
  const host = hostFromUrl(analyzedUrl);
  const candidates = [
    `sc-domain:${host}`,
    `https://${host}/`,
    `https://www.${host}/`,
    `http://${host}/`,
    `http://www.${host}/`,
  ];
  for (const c of candidates) {
    const hit = sites.find((s) => s === c || s.replace(/\/$/, "") === c.replace(/\/$/, ""));
    if (hit) return hit;
  }
  const partial = sites.find((s) => {
    const norm = s.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
    return norm === host || norm.endsWith("." + host);
  });
  return partial || sites[0];
}

export function displaySite(site: string): string {
  return site.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}
