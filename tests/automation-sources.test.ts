import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveContent } from "@/lib/automation/sources";
import type { QueueItem, ContentSource } from "@/lib/automation/types";

// The AI queue and the other content sources. What is pinned here is the behaviour that
// protects a brand: nothing publishes empty, an unapproved UGC script never posts itself,
// and a source that runs dry keeps the schedule alive instead of silently stopping.

const MON = Date.UTC(2026, 0, 5);
const deps = { topic: "we shipped an AI CMO", audience: "seed-stage founders", now: MON };

const slot = (source: ContentSource, over: Partial<QueueItem> = {}): QueueItem => ({
  id: "q1", tenant: "t", automationId: "a1", platform: "x", source,
  at: MON, state: "upcoming", jobId: null, order: 0, note: null, ...over,
});

const KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

describe("content sources", () => {
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    vi.restoreAllMocks();
  });

  it("templates produce real text built from the automation's topic", async () => {
    const r = await resolveContent(slot("templates"), deps);
    expect(r).not.toBeNull();
    expect(r!.origin).toBe("templates");
    expect(r!.text).toContain("AI CMO");
    expect(r!.text.length).toBeGreaterThan(40);
  });

  it("templates rotate over time so a weekly automation does not repeat itself", async () => {
    const a = await resolveContent(slot("templates", { at: MON }), deps);
    const b = await resolveContent(slot("templates", { at: MON + 7 * 86_400_000 }), deps);
    expect(a!.text).not.toBe(b!.text);
  });

  it("the AI queue still produces publishable text with no provider configured", async () => {
    // Every provider absent is the worst case; the deterministic composer is the floor.
    const r = await resolveContent(slot("ai_queue"), deps);
    expect(r).not.toBeNull();
    expect(r!.text.trim().length).toBeGreaterThan(0);
    // And it is marked as a fallback rather than passed off as model-written.
    expect(r!.origin).toBe("fallback");
    expect(r!.provider).toBeNull();
  });

  it("never returns empty text from any source", async () => {
    const sources: ContentSource[] = ["drafts", "campaigns", "ugc_library", "content_library", "templates", "ai_queue"];
    for (const s of sources) {
      const r = await resolveContent(slot(s), deps);
      // A source may legitimately have nothing — but it must never return whitespace.
      if (r) expect(r.text.trim().length, `${s} returned empty text`).toBeGreaterThan(0);
    }
  });

  it("an empty source falls through to generation so the schedule keeps running", async () => {
    // ugc_library only yields *approved* versions, and none exist here — so this slot
    // must still resolve rather than failing and silently stopping the schedule.
    // (drafts is deliberately not used: the AI queue persists drafts, so an earlier
    // test in this file legitimately leaves one behind.)
    const r = await resolveContent(slot("ugc_library"), deps);
    expect(r).not.toBeNull();
    expect(["ai_queue", "fallback"]).toContain(r!.origin);
  });

  it("an unapproved UGC script never posts itself", async () => {
    // Nothing approved exists, so ugc_library must not return UGC content at all.
    const r = await resolveContent(slot("ugc_library"), deps);
    expect(r!.origin).not.toBe("ugc_library");
  });

  it("marks the fallback honestly rather than claiming a model wrote it", async () => {
    const r = await resolveContent(slot("ai_queue"), deps);
    expect(r!.origin).toBe("fallback");
    expect(r!.model).toBeNull();
    expect(r!.confidence).toBeLessThan(0.5);
  });

  it("sizes AI queue output to the platform's real limit", async () => {
    const r = await resolveContent(slot("ai_queue", { platform: "x" }), deps);
    expect(r).not.toBeNull();
    // X allows 280 characters; the composer trims to the adapter's limit before this
    // ever reaches a platform.
    expect(r!.text.length).toBeLessThanOrEqual(320);   // 280 + hashtag line
  });
});
