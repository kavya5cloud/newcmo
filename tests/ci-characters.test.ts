import { describe, it, expect } from "vitest";
import { buildCharacter, InMemoryCharacterStore } from "@/lib/creative-intelligence/characters";
import type { Persona } from "@/lib/creative-intelligence/types";

const persona: Persona = { name: "Sam", audience: "founders", motivations: ["ship faster"], objections: ["no time"] };

describe("Character Engine", () => {
  it("builds a complete, deterministic character", () => {
    const c1 = buildCharacter({ name: "Sam", persona, brandVoice: "confident" });
    const c2 = buildCharacter({ name: "Sam", persona, brandVoice: "confident" });
    expect(c1.id).toBe(c2.id);
    expect(c1.voice).toBeTruthy();
    expect(c1.expressions.length).toBeGreaterThan(0);
    expect(c1.movementStyle).toBeTruthy();
    expect(c1.identity.toLowerCase()).toContain("founders");
  });

  it("stores and lists characters by workspace", async () => {
    const store = new InMemoryCharacterStore();
    const a = buildCharacter({ name: "A", persona, brandVoice: "x", workspaceKey: "ws1" });
    const b = buildCharacter({ name: "B", persona, brandVoice: "x", workspaceKey: "ws2" });
    await store.create(a); await store.create(b);
    expect((await store.list("ws1")).map((c) => c.name)).toEqual(["A"]);
    expect(await store.get(a.id)).not.toBeNull();
    expect((await store.list()).length).toBe(2);
  });
});
