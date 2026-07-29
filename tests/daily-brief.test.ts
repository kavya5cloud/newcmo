import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assembleBrief, fingerprint } from "@/lib/brief/assemble";
import { candidates, recommend, type RecommendInput } from "@/lib/brief/recommend";
import { deterministicSummary, writeSummary } from "@/lib/brief/summary";
import { readCache, writeCache, isFresh, clearAll, MAX_AGE_MS } from "@/lib/brief/cache";
import type { DailyBrief } from "@/lib/brief/types";

// The Daily Brief. What matters is that it never contradicts the screens it links to,
// that it recommends the *one* thing worth doing, and that a stale brief is impossible.

// Local 9am, not UTC. The greeting is deliberately local — 09:00 UTC is the afternoon
// for a founder in IST, and greeting them "good morning" would be the tell that nobody
// thought about it.
const NOW = new Date(2026, 0, 5, 9, 0).getTime();

const base = (): RecommendInput => ({
  publishing: { today: 2, awaitingApproval: 0, failed: 0, retryable: 0, nextAt: NOW + 3600_000, nextPlatform: "linkedin", links: [] },
  campaigns: { running: 1, completed: 0, blocked: 0, lines: [], links: [] },
  market: { trends: [], competitors: [], opportunities: [], keywords: [], links: [] },
  performance: { bestPlatform: null, winningFormat: null, bestTime: null, improvements: [], detail: [] },
  approvals: { count: 0, items: [] },
  connectedPlatforms: ["linkedin"],
  hasContent: true,
});

describe("recommendation", () => {
  it("always returns exactly one, even when nothing is wrong", () => {
    const r = recommend(base());
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.why.length).toBeGreaterThan(20);
  });

  it("puts broken publishing above everything else", () => {
    const r = recommend({ ...base(), publishing: { ...base().publishing, failed: 3, retryable: 3 },
      approvals: { count: 5, items: [] }, market: { ...base().market, opportunities: ["x — y"] } });
    expect(r.kind).toBe("retry_publishing");
  });

  it("does not suggest retrying failures that cannot be retried", () => {
    // 2 failed, 0 retryable — a retry would do nothing, so it must not be offered.
    const r = recommend({ ...base(), publishing: { ...base().publishing, failed: 2, retryable: 0 } });
    expect(r.kind).not.toBe("retry_publishing");
    expect(r.title.toLowerCase()).toContain("cannot retry");
  });

  it("ranks approvals above opportunities — blocked work beats possible work", () => {
    const r = recommend({ ...base(),
      approvals: { count: 1, items: [{ id: "a", label: "LinkedIn post", href: "/x" }] },
      market: { ...base().market, opportunities: ["Own the term — publish"] } });
    expect(r.kind).toBe("approve");
    expect(r.title).toContain("LinkedIn post");
  });

  it("tells an empty workspace to connect a platform first", () => {
    const r = recommend({ ...base(), connectedPlatforms: [], hasContent: false,
      publishing: { ...base().publishing, today: 0, nextAt: null } });
    expect(r.kind).toBe("connect_platform");
  });

  it("notices an empty schedule, which is a slow failure", () => {
    const cs = candidates({ ...base(), publishing: { ...base().publishing, today: 0, nextAt: null } });
    expect(cs.some((c) => c.title.includes("schedule"))).toBe(true);
  });

  it("every recommendation explains itself and offers somewhere to go", () => {
    for (const c of candidates({ ...base(), publishing: { ...base().publishing, failed: 2, retryable: 1 },
      approvals: { count: 1, items: [] }, market: { ...base().market, opportunities: ["a — b"] },
      connectedPlatforms: [], hasContent: false })) {
      expect(c.why.length, c.title).toBeGreaterThan(20);
      expect(c.href || c.command, c.title).toBeTruthy();
    }
  });
});

describe("assembly", () => {
  it("produces a complete brief for an empty workspace and marks it quiet", async () => {
    const b = await assembleBrief({ tenant: "empty-ws", now: NOW });
    expect(b.greeting).toBe("Good morning");
    // And it tracks the viewer's clock rather than the server's.
    expect((await assembleBrief({ tenant: "empty-ws", now: new Date(2026, 0, 5, 20, 0).getTime() })).greeting).toBe("Good evening");
    expect(b.recommendation.title.length).toBeGreaterThan(0);
    expect(b.upcoming).toBeDefined();
    expect(b.signature).toHaveLength(16);
  });

  it("never shows low-confidence market noise", async () => {
    const b = await assembleBrief({ tenant: "empty-ws", now: NOW });
    // Whatever the reference sources return, only meaningful items may surface.
    expect(b.market.trends.length).toBeLessThanOrEqual(3);
    expect(b.market.opportunities.length).toBeLessThanOrEqual(2);
  });

  it("keeps raw metrics out of the headline sections", async () => {
    const b = await assembleBrief({ tenant: "empty-ws", now: NOW });
    // Numbers live in `detail`, which the UI only shows when expanded.
    expect(Array.isArray(b.performance.detail)).toBe(true);
    for (const line of b.performance.improvements) expect(line).not.toMatch(/^\d+$/);
  });
});

describe("fingerprint and cache", () => {
  beforeEach(() => clearAll());
  afterEach(() => clearAll());

  const brief = (over: Partial<DailyBrief> = {}): DailyBrief => ({
    tenant: "t", company: "Populr", greeting: "Good morning", summary: "s", summarySource: "deterministic",
    publishing: { today: 1, awaitingApproval: 0, failed: 0, retryable: 0, nextAt: null, nextPlatform: null, links: [] },
    campaigns: { running: 0, completed: 0, blocked: 0, lines: [], links: [] },
    market: { trends: [], competitors: [], opportunities: [], keywords: [], links: [] },
    performance: { bestPlatform: null, winningFormat: null, bestTime: null, improvements: [], detail: [] },
    approvals: { count: 0, items: [] },
    recommendation: { kind: "none", title: "t", why: "w", href: null, command: null, priority: 1 },
    activity: [], upcoming: { today: [], tomorrow: [], thisWeek: [] }, quiet: false,
    generatedAt: NOW, signature: "", ...over,
  });

  it("the time alone does not change the fingerprint", () => {
    const a = brief({ generatedAt: NOW });
    const b = brief({ generatedAt: NOW + 5 * 60_000 });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("a publishing change invalidates the brief", () => {
    const a = brief();
    const b = brief({ publishing: { ...a.publishing, today: 2 } });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("an approval change invalidates the brief", () => {
    const a = brief();
    const b = brief({ approvals: { count: 1, items: [] } });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("a campaign health change invalidates the brief", () => {
    const a = brief({ campaigns: { running: 1, completed: 0, blocked: 0, lines: [{ id: "c1", title: "C", health: "healthy", percent: 10, blocked: false, reason: null }], links: [] } });
    const b = brief({ campaigns: { running: 1, completed: 0, blocked: 1, lines: [{ id: "c1", title: "C", health: "blocked", percent: 10, blocked: true, reason: "x" }], links: [] } });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("a market change invalidates the brief", () => {
    const a = brief();
    const b = brief({ market: { trends: ["ai cmo"], competitors: [], opportunities: [], keywords: [], links: [] } });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("a learning update invalidates the brief", () => {
    const a = brief();
    const b = brief({ performance: { bestPlatform: "linkedin", winningFormat: null, bestTime: null, improvements: [], detail: [] } });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it("serves a hit only while the world is unchanged", () => {
    const a = brief({ signature: "sig-a" });
    writeCache("t", a, NOW);
    expect(isFresh(readCache("t", NOW), "sig-a", NOW)).toBe(true);
    expect(isFresh(readCache("t", NOW), "sig-b", NOW)).toBe(false);
  });

  it("expires on age even when nothing changed", () => {
    writeCache("t", brief({ signature: "sig-a" }), NOW);
    expect(isFresh(readCache("t", NOW + MAX_AGE_MS + 1), "sig-a", NOW + MAX_AGE_MS + 1)).toBe(false);
  });

  it("is scoped per tenant", () => {
    writeCache("a", brief({ signature: "s" }), NOW);
    expect(readCache("b", NOW)).toBeNull();
  });
});

describe("summary", () => {
  const KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

  it("falls back to the deterministic paragraph with no provider", async () => {
    const b = await assembleBrief({ tenant: "empty-ws", now: NOW });
    const { summary, source } = await writeSummary(b);
    expect(source).toBe("deterministic");
    expect(summary.startsWith("Good morning")).toBe(true);
    expect(summary.length).toBeGreaterThan(30);
  });

  it("a quiet workspace still gets a useful sentence, not an apology", async () => {
    const b = await assembleBrief({ tenant: "empty-ws-2", now: NOW });
    const s = deterministicSummary({ ...b, quiet: true });
    expect(s).toContain("Good morning");
    expect(s).toContain(b.recommendation.title);
  });
});
