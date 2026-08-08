// Numbers for the traffic chart.
//
// When Search Console is connected the chart draws real data. Before that it draws an
// estimate, shaped by a seeded RNG so the same site always produces the same curve — a
// placeholder that reshuffled on every render would look like live data that cannot be
// trusted.


export const CHART = {
  "7d": { labels: ["7/5", "7/6", "7/7", "7/8", "7/9", "7/10", "7/11"], visits: [2100, 3050, 2700, 1900, 2050, 2350, 2600], clicks: [420, 510, 480, 390, 410, 460, 520], saw: "82.4K", sawD: "+12.3%", clicked: "3.9K", clickedD: "+48.2%", visited: "15.1K", visitedD: "+21.4%" },
  "30d": { labels: ["6/12", "6/17", "6/22", "6/27", "7/2", "7/7", "7/11"], visits: [1500, 1800, 2400, 2200, 2900, 2600, 3100], clicks: [280, 330, 450, 410, 520, 480, 560], saw: "301K", sawD: "+9.8%", clicked: "13.2K", clickedD: "+31.5%", visited: "54.7K", visitedD: "+17.9%" },
};

// deterministic PRNG seeded from a string, so a given site always shows the same estimate
export function seedRand(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function fmtN(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}
export function dayLabels(range: "7d" | "30d"): string[] {
  const out: string[] = [];
  const step = range === "7d" ? 1 : 5;
  for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - (i * step + 2) * 86400000); out.push(`${d.getMonth() + 1}/${d.getDate()}`); }
  return out;
}
// Build a CHART-shaped view from monthly estimates, scaled to the range with plausible variance.
export function buildEstData(est: { impressions: number; clicks: number; visits: number }, range: "7d" | "30d", seed: string) {
  const rnd = seedRand(seed + range);
  const scale = (range === "7d" ? 7 : 30) / 30;
  const impT = est.impressions * scale, clkT = est.clicks * scale, visT = est.visits * scale;
  const w = Array.from({ length: 7 }, () => 0.55 + rnd() * 0.9);
  const wsum = w.reduce((a, b) => a + b, 0);
  const visits = w.map((x) => Math.round((visT * x) / wsum));
  const clicks = w.map((x) => Math.round((clkT * x) / wsum));
  const delta = () => "+" + (4 + Math.floor(rnd() * 42)) + "." + Math.floor(rnd() * 10) + "%";
  return {
    labels: dayLabels(range), visits, clicks,
    saw: fmtN(impT), sawD: delta(), clicked: fmtN(clkT), clickedD: delta(), visited: fmtN(visT), visitedD: delta(),
  };
}
