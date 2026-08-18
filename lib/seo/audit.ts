// A real site audit.
//
// Every number here is measured by Google and reported verbatim. That is the entire design
// constraint, and it is not a stylistic one: this product ships a guide called "why AI
// marketing tools invent statistics", and a dashboard panel headed "PageSpeed" showing a
// score nobody measured would be the end of the argument.
//
// So: PageSpeed Insights runs Lighthouse against a URL and returns category scores and lab
// metrics. We ask, we parse, we display. Where a field is missing we show nothing rather than
// a default — a zero looks like a measurement, and "—" looks like what it is.
//
// The on-page signals below are the exception, and they are also measurements: title length,
// meta description, h1 count, canonical, viewport. Those are read off the HTML we fetched,
// not inferred.

export type ScoreSet = {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
};

/** A lab metric with the threshold that decides pass/fail, so the verdict is explainable. */
export type Vital = {
  id: "lcp" | "fcp" | "tbt" | "cls" | "si";
  label: string;
  /** Formatted the way Google formats it — "1.7 s", "89 ms", "0.001". */
  display: string;
  /** Raw numeric value in the metric's own unit, for comparisons. */
  value: number;
  verdict: "pass" | "needs-work" | "fail";
};

export type SeoSignal = {
  label: string;
  value: string;
  verdict: "pass" | "warn" | "fail";
  /** Why it matters, in one line. A warning nobody understands is a warning nobody acts on. */
  note: string;
};

export type SeoIssue = {
  title: string;
  severity: "warning" | "error";
  detail: string;
};

export type AuditResult = {
  url: string;
  fetchedAt: number;
  mobile: ScoreSet;
  desktop: ScoreSet;
  vitals: { mobile: Vital[]; desktop: Vital[] };
  signals: SeoSignal[];
  issues: SeoIssue[];
  /** Present when something could not be measured. Never silently degraded. */
  problems: string[];
};

const PSI = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** 0..1 from Lighthouse becomes 0..100, or null when the category did not run. */
function score(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.round(raw * 100);
}

/**
 * Core Web Vitals thresholds, from Google's own guidance.
 *
 * Written down rather than hardcoded into comparisons so the numbers can be checked against
 * the public documentation without reading the logic around them.
 */
const THRESHOLDS: Record<Vital["id"], { good: number; poor: number; label: string }> = {
  lcp: { good: 2500, poor: 4000, label: "LCP" },
  fcp: { good: 1800, poor: 3000, label: "FCP" },
  tbt: { good: 200, poor: 600, label: "TBT" },
  cls: { good: 0.1, poor: 0.25, label: "CLS" },
  si: { good: 3400, poor: 5800, label: "Speed Index" },
};

const AUDIT_IDS: Record<Vital["id"], string> = {
  lcp: "largest-contentful-paint",
  fcp: "first-contentful-paint",
  tbt: "total-blocking-time",
  cls: "cumulative-layout-shift",
  si: "speed-index",
};

function verdictFor(id: Vital["id"], value: number): Vital["verdict"] {
  const t = THRESHOLDS[id];
  if (value <= t.good) return "pass";
  if (value <= t.poor) return "needs-work";
  return "fail";
}

type LighthouseAudit = { numericValue?: number; displayValue?: string; score?: number };

function vitalsFrom(audits: Record<string, LighthouseAudit> | undefined): Vital[] {
  if (!audits) return [];
  const out: Vital[] = [];
  for (const id of Object.keys(AUDIT_IDS) as Vital["id"][]) {
    const a = audits[AUDIT_IDS[id]];
    const value = a?.numericValue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    out.push({
      id,
      label: THRESHOLDS[id].label,
      // Google's own formatting when it gives one; ours only as a fallback, and never
      // invented — the raw value is always what was measured.
      display: a?.displayValue ?? (id === "cls" ? value.toFixed(3) : `${Math.round(value)} ms`),
      value,
      verdict: verdictFor(id, value),
    });
  }
  return out;
}

/** One PageSpeed run. Returns null rather than throwing, so one strategy failing is survivable. */
async function runPsi(url: string, strategy: "mobile" | "desktop", signal: AbortSignal) {
  const q = new URLSearchParams({ url, strategy });
  // Categories must be repeated, not comma-joined — the API ignores the joined form and
  // silently returns performance only, which reads as "the other three scored zero".
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) q.append("category", c);
  const key = process.env.PAGESPEED_API_KEY?.trim();
  if (key) q.set("key", key);

  const res = await fetch(`${PSI}?${q}`, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) return { ok: false as const, status: res.status, body: (await res.text()).slice(0, 300) };
  const json = await res.json();
  return { ok: true as const, json };
}

type PsiJson = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number }>;
    audits?: Record<string, LighthouseAudit>;
  };
};

function scoresFrom(json: PsiJson): ScoreSet {
  const c = json?.lighthouseResult?.categories ?? {};
  return {
    performance: score(c.performance?.score),
    accessibility: score(c.accessibility?.score),
    bestPractices: score(c["best-practices"]?.score),
    seo: score(c.seo?.score),
  };
}

/**
 * On-page signals, read off the page's own HTML.
 *
 * Deliberately small and deliberately checkable. Every one of these is a fact about the
 * document — a length, a presence, a count — not a judgement about quality. "Readability:
 * Standard" is the kind of signal that sounds measured and is not, so it is not here.
 */
export function readSignals(html: string): { signals: SeoSignal[]; issues: SeoIssue[] } {
  const signals: SeoSignal[] = [];
  const issues: SeoIssue[] = [];

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const titleLen = title.length;
  signals.push({
    label: "Title tag",
    value: titleLen ? `${titleLen} chars` : "missing",
    // Google truncates around 60; under 30 usually means the page is not saying what it is.
    verdict: titleLen === 0 ? "fail" : titleLen < 30 || titleLen > 60 ? "warn" : "pass",
    note: "Google shows roughly 60 characters. Under 30 usually wastes the strongest signal on the page.",
  });
  if (titleLen === 0) issues.push({ title: "No title tag", severity: "error", detail: "The page has no <title>. This is the single strongest on-page signal." });
  else if (titleLen < 30) issues.push({ title: "Title tag too short", severity: "warning", detail: `${titleLen} characters. There is room to say what the page is for.` });
  else if (titleLen > 60) issues.push({ title: "Title tag will be truncated", severity: "warning", detail: `${titleLen} characters — Google will cut it around 60.` });

  const desc = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
  signals.push({
    label: "Meta description",
    value: desc ? `${desc.length} chars` : "missing",
    verdict: !desc ? "warn" : desc.length < 70 || desc.length > 160 ? "warn" : "pass",
    note: "Not a ranking factor, but it is the sentence that decides whether the result gets clicked.",
  });
  if (!desc) issues.push({ title: "No meta description", severity: "warning", detail: "Google will invent one from the page, and it is usually worse than yours." });

  const h1s = html.match(/<h1[\s>]/gi)?.length ?? 0;
  signals.push({
    label: "H1",
    value: h1s === 1 ? "1 found" : `${h1s} found`,
    verdict: h1s === 1 ? "pass" : "warn",
    note: "One H1 states the page's subject. Zero leaves it unstated; several leave it ambiguous.",
  });
  if (h1s === 0) issues.push({ title: "No H1 heading", severity: "warning", detail: "Nothing on the page states its subject in a heading." });
  else if (h1s > 1) issues.push({ title: `${h1s} H1 headings`, severity: "warning", detail: "Multiple H1s split the page's stated subject." });

  const canonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  signals.push({
    label: "Canonical",
    value: canonical ? "present" : "missing",
    verdict: canonical ? "pass" : "warn",
    note: "Tells Google which URL is the real one when several serve the same page.",
  });
  if (!canonical) issues.push({ title: "No canonical link", severity: "warning", detail: "Query strings and variants may be indexed as separate pages." });

  const viewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  signals.push({
    label: "Mobile viewport",
    value: viewport ? "set" : "missing",
    verdict: viewport ? "pass" : "fail",
    note: "Without it, mobile browsers render at desktop width and Google treats the page as not mobile-friendly.",
  });
  if (!viewport) issues.push({ title: "No viewport meta tag", severity: "error", detail: "The page is not mobile-friendly, and most search traffic is mobile." });

  const og = /<meta[^>]+property=["']og:(title|image)["']/i.test(html);
  signals.push({
    label: "Open Graph",
    value: og ? "present" : "missing",
    verdict: og ? "pass" : "warn",
    note: "Decides what the link looks like when someone shares it. Missing means a bare URL.",
  });

  const structured = (html.match(/application\/ld\+json/gi) ?? []).length;
  signals.push({
    label: "Structured data",
    value: structured ? `${structured} block${structured === 1 ? "" : "s"}` : "none",
    verdict: structured ? "pass" : "warn",
    note: "How rich results and AI answers work out what the page is about.",
  });

  return { signals, issues };
}

/**
 * Audit a URL.
 *
 * Both strategies run together — the API is slow enough (several seconds each) that running
 * them in series is felt. A failure in one is reported and the other is still shown, because
 * half an audit beats an error page.
 */
export async function auditUrl(url: string, opts: { timeoutMs?: number } = {}): Promise<AuditResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  const problems: string[] = [];

  try {
    const [mobileRes, desktopRes, page] = await Promise.all([
      runPsi(url, "mobile", controller.signal).catch((e) => ({ ok: false as const, status: 0, body: String(e).slice(0, 160) })),
      runPsi(url, "desktop", controller.signal).catch((e) => ({ ok: false as const, status: 0, body: String(e).slice(0, 160) })),
      fetch(url, { signal: controller.signal, headers: { "User-Agent": "populr-audit/1.0" } })
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => ""),
    ]);

    const empty: ScoreSet = { performance: null, accessibility: null, bestPractices: null, seo: null };

    if (!mobileRes.ok) problems.push(`Mobile audit unavailable (${mobileRes.status || "network"}).`);
    if (!desktopRes.ok) problems.push(`Desktop audit unavailable (${desktopRes.status || "network"}).`);
    if (!page) problems.push("Could not read the page's HTML, so on-page signals were skipped.");

    const onPage = page ? readSignals(page) : { signals: [], issues: [] };

    // Lighthouse's own failed audits, which name real problems in the words Google uses.
    // Capped: a long list of low-severity opportunities is a wall, not a to-do.
    const lhIssues: SeoIssue[] = [];
    if (mobileRes.ok) {
      const audits = (mobileRes.json as PsiJson)?.lighthouseResult?.audits ?? {};
      for (const id of ["render-blocking-resources", "unminified-javascript", "uses-responsive-images", "server-response-time"]) {
        const a = audits[id] as (LighthouseAudit & { title?: string }) | undefined;
        if (a && typeof a.score === "number" && a.score < 0.9 && a.title) {
          lhIssues.push({ title: a.title, severity: "warning", detail: a.displayValue ?? "Flagged by Lighthouse on mobile." });
        }
      }
    }

    return {
      url,
      fetchedAt: Date.now(),
      mobile: mobileRes.ok ? scoresFrom(mobileRes.json as PsiJson) : empty,
      desktop: desktopRes.ok ? scoresFrom(desktopRes.json as PsiJson) : empty,
      vitals: {
        mobile: mobileRes.ok ? vitalsFrom((mobileRes.json as PsiJson)?.lighthouseResult?.audits) : [],
        desktop: desktopRes.ok ? vitalsFrom((desktopRes.json as PsiJson)?.lighthouseResult?.audits) : [],
      },
      signals: onPage.signals,
      issues: [...onPage.issues, ...lhIssues],
      problems,
    };
  } finally {
    clearTimeout(timer);
  }
}
