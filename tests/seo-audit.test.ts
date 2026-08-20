import { describe, expect, it, vi } from "vitest";
import { readSignals } from "@/lib/seo/audit";

// This panel shows numbers next to the word "PageSpeed", so the standard is higher than
// usual: every value must be a measurement. These cover the reading of on-page signals, which
// is the half that runs locally — the Lighthouse half is Google's and is asserted by the
// route reporting `problems` rather than substituting defaults.

const page = (head: string) => `<!doctype html><html><head>${head}</head><body><h1>Hi</h1></body></html>`;

describe("on-page signals are read, not guessed", () => {
  it("measures title length and flags a short one", () => {
    const { signals, issues } = readSignals(page(`<title>Populr — your AI CMO</title>`));
    const title = signals.find((s) => s.label === "Title tag")!;
    // 20, not 22 — I miscounted writing this. Worth keeping as the fixture: it is the real
    // title of trypopulr.in, and Okara's audit of the same site reported the same 20 chars,
    // which is a useful independent check that this reader agrees with a competitor's.
    expect(title.value).toBe("20 chars");
    expect(title.verdict).toBe("warn");
    expect(issues.some((i) => i.title === "Title tag too short")).toBe(true);
  });

  it("flags a title that Google will cut", () => {
    const long = "A".repeat(75);
    const { issues } = readSignals(page(`<title>${long}</title>`));
    expect(issues.some((i) => i.title === "Title tag will be truncated")).toBe(true);
  });

  it("treats a missing title as an error, not a warning", () => {
    // The strongest on-page signal being absent is a different class of problem from it
    // being the wrong length.
    const { issues } = readSignals(page(``));
    expect(issues.find((i) => i.title === "No title tag")?.severity).toBe("error");
  });

  it("treats a missing viewport as an error", () => {
    // Most search traffic is mobile; without this the page is not mobile-friendly at all.
    const { issues } = readSignals(page(`<title>${"x".repeat(40)}</title>`));
    expect(issues.find((i) => i.title === "No viewport meta tag")?.severity).toBe("error");
  });

  it("counts H1s rather than assuming one", () => {
    const html = `<html><head><title>${"x".repeat(40)}</title></head><body><h1>a</h1><h1>b</h1></body></html>`;
    const { signals, issues } = readSignals(html);
    expect(signals.find((s) => s.label === "H1")!.value).toBe("2 found");
    expect(issues.some((i) => i.title === "2 H1 headings")).toBe(true);
  });

  it("counts structured-data blocks", () => {
    const html = page(`<title>${"x".repeat(40)}</title><script type="application/ld+json">{}</script><script type="application/ld+json">{}</script>`);
    expect(readSignals(html).signals.find((s) => s.label === "Structured data")!.value).toBe("2 blocks");
  });

  it("passes a page that has its house in order", () => {
    const html = page(
      `<title>${"x".repeat(45)}</title>` +
      `<meta name="description" content="${"y".repeat(120)}">` +
      `<link rel="canonical" href="https://example.com">` +
      `<meta name="viewport" content="width=device-width">` +
      `<meta property="og:title" content="x">` +
      `<script type="application/ld+json">{}</script>`,
    );
    const { signals, issues } = readSignals(html);
    expect(signals.every((s) => s.verdict === "pass")).toBe(true);
    expect(issues).toEqual([]);
  });

  it("gives every signal a reason a person can act on", () => {
    // A warning nobody understands is a warning nobody acts on.
    for (const s of readSignals(page(`<title>x</title>`)).signals) {
      expect(s.note.length, `${s.label} has no note`).toBeGreaterThan(20);
    }
  });
});

// The screen showed "Mobile audit unavailable (429). Desktop audit unavailable (429)." —
// two lines carrying one fact, and a status code presented to someone whose dials are
// blank as though it were their problem. It is not: 429 is Google throttling us.
describe("what the panel says when Google will not answer", () => {
  const psiFail = (status: number) =>
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("pagespeedonline")) return new Response("rate limited", { status });
      // The page itself still fetches, so on-page signals survive a PSI failure.
      return new Response(page(`<title>Populr — your AI CMO</title>`), { status: 200 });
    });

  it("says it once, blames the right party, and keeps the status code out of it", async () => {
    vi.stubGlobal("fetch", psiFail(429));
    const { auditUrl } = await import("@/lib/seo/audit");
    const r = await auditUrl("https://example.com");
    vi.unstubAllGlobals();

    expect(r.problems.length).toBe(1);
    expect(r.problems[0]).toContain("rate-limiting our requests");
    expect(r.problems[0]).not.toContain("429");
    // And it must not read as the site being broken.
    expect(r.problems[0]).toMatch(/not blocking your site/i);
  });

  it("still reports the half that runs locally rather than failing whole", async () => {
    vi.stubGlobal("fetch", psiFail(429));
    const { auditUrl } = await import("@/lib/seo/audit");
    const r = await auditUrl("https://example.com");
    vi.unstubAllGlobals();
    // On-page signals come from the page's own HTML and owe Google nothing.
    expect(r.signals.length).toBeGreaterThan(0);
    // Unmeasured scores stay null. A zero here would read as "your site scored zero".
    expect(r.mobile.performance).toBeNull();
  });

  it("distinguishes a throttle from a plain failure, because the advice differs", async () => {
    vi.stubGlobal("fetch", psiFail(500));
    const { auditUrl } = await import("@/lib/seo/audit");
    const r = await auditUrl("https://example.com");
    vi.unstubAllGlobals();
    expect(r.problems[0]).toContain("try again shortly");
    expect(r.problems[0]).not.toContain("rate-limiting");
  });
});
