/** Match an analyzed website URL to the best GSC property. */

export function hostFromUrl(u: string): string {
  try {
    return new URL(u.startsWith("http") ? u : "https://" + u).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return u.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

function normalizeSite(site: string) {
  return site
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function matchGscSite(sites: string[], analyzedUrl: string): string | null {
  if (!sites.length) return null;
  const host = hostFromUrl(analyzedUrl);
  const hostParts = host.split(".");
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
  const scored = sites
    .map((site) => {
      const norm = normalizeSite(site);
      const score =
        norm === host ? 100 :
        norm.endsWith("." + host) ? 90 :
        host.endsWith("." + norm) ? 80 :
        hostParts.length > 1 && norm === hostParts.slice(-2).join(".") ? 70 :
        norm.endsWith(hostParts.slice(-2).join(".")) ? 60 :
        norm.includes(host) || host.includes(norm) ? 30 : 0;
      return { site, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0].site : sites[0];
}

export function displaySite(site: string): string {
  return site.replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/$/, "");
}
