import { describe, expect, it } from "vitest";
import { bestResult, siteLabel, type SnapshotMetrics } from "@/lib/results/headline";

// The one line on the dashboard that answers "did this work". It was being computed weekly
// and delivered only as a push notification, so every customer with notifications off — most
// of them — generated a result and never saw it.
//
// The rule that matters most here: nothing measured means nothing said. A dashboard
// reporting "0% growth" for a business that has simply not been measured yet is worse than
// one that stays quiet.

const AT = 1_000_000;
const m = (over: Partial<SnapshotMetrics> = {}): SnapshotMetrics => ({
  clicks: 100, impressions: 1000, ctr: 0.1, position: 12, topQueries: [], ...over,
});

describe("only real movement is reported", () => {
  it("says nothing when the week was flat", () => {
    expect(bestResult(m(), m(), "https://x.com", AT)).toBeNull();
  });

  it("says nothing when a metric fell", () => {
    // A dip belongs in the full table on /worked, next to everything else, where it cannot
    // be mistaken for the headline.
    expect(bestResult(m({ clicks: 100 }), m({ clicks: 40 }), "https://x.com", AT)).toBeNull();
  });

  it("ignores a big percentage on a tiny base", () => {
    // 4 clicks to 9 is +125% and means nothing.
    expect(bestResult(m({ clicks: 4 }), m({ clicks: 9 }), "https://x.com", AT)).toBeNull();
    // 60 impressions to 150 is +150% and is still noise.
    expect(bestResult(m({ impressions: 60 }), m({ impressions: 150 }), "https://x.com", AT)).toBeNull();
  });
});

describe("the most checkable claim wins", () => {
  const withQuery = (pos: number, impressions = 200) =>
    m({ clicks: 300, impressions: 5000, ctr: 0.4, topQueries: [{ query: "ai cmo", clicks: 20, impressions, position: pos }] });

  it("leads with a named query over a percentage, because it can be verified", () => {
    // Both a rank gain and a clicks jump are available; the query is the concrete one.
    const r = bestResult(withQuery(9), withQuery(4), "https://x.com", AT)!;
    expect(r.kind).toBe("rank");
    expect(r.text).toContain('"ai cmo" moved up 5 places');
  });

  it("will not call a rank change on an impression count too small to mean one", () => {
    const r = bestResult(withQuery(9, 5), withQuery(4, 5), "https://x.com", AT);
    // Falls through to a percentage metric or nothing — never the ranking claim.
    expect(r?.kind).not.toBe("rank");
  });

  it("falls back through CTR, clicks, then impressions", () => {
    expect(bestResult(m({ ctr: 0.1 }), m({ ctr: 0.2, impressions: 1000 }), "https://x.com", AT)!.kind).toBe("ctr");
    expect(bestResult(m({ clicks: 100 }), m({ clicks: 200 }), "https://x.com", AT)!.kind).toBe("clicks");
    expect(bestResult(m({ impressions: 1000 }), m({ impressions: 2000 }), "https://x.com", AT)!.kind).toBe("impressions");
  });
});

describe("the sentence reads like a person wrote it", () => {
  it("strips the scheme and the sc-domain prefix", () => {
    expect(siteLabel("sc-domain:trypopulr.in")).toBe("trypopulr.in");
    expect(siteLabel("https://www.trypopulr.in/")).toBe("www.trypopulr.in");
  });

  it("names the real before and after rather than only a percentage", () => {
    const r = bestResult(m({ clicks: 40 }), m({ clicks: 90 }), "https://x.com", AT)!;
    expect(r.text).toContain("40 to 90");
  });

  it("carries no vendor, model or internal wording", () => {
    const r = bestResult(m({ clicks: 40 }), m({ clicks: 90 }), "sc-domain:trypopulr.in", AT)!;
    expect(r.text).not.toMatch(/snapshot|metric|workspace|gsc/i);
  });
});
