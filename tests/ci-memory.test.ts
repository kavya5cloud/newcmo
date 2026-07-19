import { describe, it, expect } from "vitest";
import {
  memoryEntry, searchMemory, MEMORY_SEED, InMemoryCreativeMemoryStore,
} from "@/lib/creative-intelligence/creative-memory";

describe("Creative Memory", () => {
  it("searches best-first with a kind filter", () => {
    const hooks = searchMemory(MEMORY_SEED, { kind: "hook" });
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks.every((e) => e.kind === "hook")).toBe(true);
  });

  it("ranks by text relevance", () => {
    const res = searchMemory(MEMORY_SEED, { text: "early access" });
    expect(res[0].value.toLowerCase()).toContain("early access");
  });

  it("records and versions entries", async () => {
    const store = new InMemoryCreativeMemoryStore([]);
    const e = memoryEntry("cta", "test cta", "Start now", 0.7);
    const first = await store.record(e);
    expect(first.version).toBe(1);
    const second = await store.record(e); // same id → version bump
    expect(second.version).toBe(2);
    expect((await store.list()).length).toBe(1);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(searchMemory(MEMORY_SEED, { kind: "cta" })))
      .toBe(JSON.stringify(searchMemory(MEMORY_SEED, { kind: "cta" })));
  });
});
