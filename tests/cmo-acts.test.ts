import { describe, expect, it } from "vitest";
import { parseCommand, COMMAND_EXAMPLES } from "@/lib/launch/command";

// The chat can now carry out instructions, so what counts as an instruction matters more
// than it did when the parser only served a command bar someone typed into deliberately.
// A question mistaken for an order would schedule a week of posts because someone wondered
// aloud — which is why the parse only ever produces an offer, never an action.

describe("plain instructions are recognised", () => {
  it("understands the examples it advertises", () => {
    for (const example of COMMAND_EXAMPLES) {
      expect(parseCommand(example).intent, example).not.toBe("unknown");
    }
  });

  it("restates what it will do before doing it", () => {
    const p = parseCommand("Schedule everything");
    expect(p.intent).toBe("schedule_all");
    expect(p.summary.length).toBeGreaterThan(10);
  });

  it("reads a quantity and a platform out of one sentence", () => {
    const p = parseCommand("Generate 10 LinkedIn posts");
    expect(p.intent).toBe("generate_assets");
    expect(p.params.quantity).toBe(10);
    expect(p.params.platform).toBe("linkedin");
  });
});

describe("conversation is not instruction", () => {
  // These are the ones that would be expensive to get wrong: each is a founder thinking out
  // loud, and each is one word away from a command.
  it("does not treat an ordinary question as an order", () => {
    for (const q of [
      "what should I post about this week",
      "how is my marketing doing",
      "why did engagement drop",
      "who is my audience",
      "is LinkedIn working for us",
    ]) {
      expect(parseCommand(q).intent, q).toBe("unknown");
    }
  });

  it("offers nothing for an empty or meaningless input", () => {
    expect(parseCommand("").intent).toBe("unknown");
    expect(parseCommand("   ").intent).toBe("unknown");
    expect(parseCommand("thanks!").intent).toBe("unknown");
  });
});

describe("the offer is deterministic", () => {
  it("gives the same reading of the same sentence every time", () => {
    const once = parseCommand("Generate 5 LinkedIn posts");
    const twice = parseCommand("Generate 5 LinkedIn posts");
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });
});

// The precedence bug this file found: alternation binds looser than \b, so /\bpause|stop|hold\b/
// anchored only the first and last words. These are the substrings that were matching.
describe("a word inside another word is not a command", () => {
  it("does not read 'marketing' as 'market'", () => {
    expect(parseCommand("how is my marketing doing").intent).toBe("unknown");
    expect(parseCommand("marketing is going well").intent).toBe("unknown");
    // The real word still works.
    expect(parseCommand("research the market").intent).toBe("research_market");
  });

  it("does not read 'nonstop' or 'stopped' as 'stop'", () => {
    expect(parseCommand("posting nonstop has been working").intent).toBe("unknown");
    expect(parseCommand("engagement stopped growing").intent).toBe("unknown");
    expect(parseCommand("pause everything").intent).toBe("pause_all");
  });

  it("still needs both halves before it offers to generate", () => {
    // "make" alone is not an instruction to produce assets.
    expect(parseCommand("make it better").intent).toBe("unknown");
    expect(parseCommand("write 3 posts").intent).toBe("generate_assets");
  });
});
