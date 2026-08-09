import { describe, expect, it } from "vitest";
import { scoreDraft, rewriteNote, formFor, AI_TELLS, CRAFT_RULES } from "@/lib/content/craft";

// The composer already refused to invent statistics. That stops content being wrong; it does
// nothing to stop it being unread, which is the more common fate. These assert the checks
// that catch machine prose — the ones that can be caught without asking a second model to
// grade the first, which would be the same system marking its own work.

const HUMAN = `Our AI CMO invented a statistic last week.

It wrote that Europeans are 2.5x more likely to engage with relevant content. No such study exists. The number is also circular — everyone engages more with things they care about.

I run an AI marketing company. I am telling you our product lied because the alternative is quietly patching it and saying nothing.

Here is the log.`;

const SLOP = `In today's fast-paced digital world, content is king. Studies show that businesses need to leverage cutting-edge solutions. It's important to note that engagement matters a lot. Let's dive in and explore the key takeaways together. At the end of the day, this is a game changer for your brand. So there you have it! 🚀🔥💡 #marketing #growth #ai #content #startup`;

describe("machine prose is caught", () => {
  it("scores obvious slop far below real writing", () => {
    expect(scoreDraft(SLOP).score).toBeLessThan(scoreDraft(HUMAN).score);
  });

  it("sends slop back for a rewrite and leaves good writing alone", () => {
    expect(scoreDraft(SLOP).needsRewrite).toBe(true);
    expect(scoreDraft(HUMAN).needsRewrite).toBe(false);
  });

  it("names the stock phrases it found", () => {
    const codes = scoreDraft(SLOP).issues.map((i) => i.code);
    expect(codes).toContain("ai_tell");
    expect(codes).toContain("vague_claim");
  });

  it("catches an unsourced claim on its own", () => {
    const s = scoreDraft("Studies show this approach works better for most teams.");
    expect(s.issues.some((i) => i.code === "vague_claim")).toBe(true);
  });

  it("catches hashtag stacks and emoji spam", () => {
    const codes = scoreDraft(SLOP).issues.map((i) => i.code);
    expect(codes).toContain("hashtag_stack");
    expect(codes).toContain("emoji_spam");
  });

  it("catches a closing summary", () => {
    const s = scoreDraft("We shipped a fix today. It took an hour. In conclusion, testing matters.");
    expect(s.issues.some((i) => i.code === "summary_ending")).toBe(true);
  });
});

describe("the two failures that are hardest to see", () => {
  it("flags an opening that would fit any post about anything", () => {
    // "In the world of X…" tells the reader nothing and is where most AI posts begin.
    const s = scoreDraft("In the world of modern marketing, teams face many challenges every day.");
    expect(s.issues.some((i) => i.code === "weak_opening")).toBe(true);
  });

  it("flags sentences that all run to the same length", () => {
    // The most reliable tell of machine prose, and invisible unless measured.
    const flat = "We build tools for founders today. They help teams move faster daily. Our platform saves time every week. Customers report better results monthly.";
    expect(scoreDraft(flat).issues.some((i) => i.code === "flat_rhythm")).toBe(true);
  });

  it("does not flag varied rhythm as flat", () => {
    expect(scoreDraft(HUMAN).issues.some((i) => i.code === "flat_rhythm")).toBe(false);
  });
});

describe("the rewrite note", () => {
  it("names the faults instead of asking for something vaguely better", () => {
    const note = rewriteNote(scoreDraft(SLOP));
    expect(note).toMatch(/remove these phrases/i);
    expect(note.length).toBeGreaterThan(40);
  });

  it("is empty when there is nothing to fix", () => {
    expect(rewriteNote(scoreDraft(HUMAN))).toBe("");
  });
});

describe("platform form", () => {
  it("says how each platform differs structurally, not just in length", () => {
    const x = formFor(["x"]);
    const li = formFor(["linkedin"]);
    expect(x).not.toBe(li);
    expect(li).toMatch(/see more/i);       // the LinkedIn truncation point
    expect(formFor(["reddit"])).toMatch(/disclose/i);
  });

  it("returns nothing rather than noise for unknown platforms", () => {
    expect(formFor(["myspace"])).toBe("");
  });
});

describe("the rules the model is given", () => {
  it("tells it to open on a specific, not a thesis", () => {
    expect(CRAFT_RULES).toMatch(/never open on a thesis/i);
  });

  it("bans the phrases the scorer checks for, so prompt and contract agree", () => {
    // If these drifted apart the model would be asked for one thing and graded on another.
    for (const tell of ["in today's", "let's dive in", "game changer"]) {
      expect(AI_TELLS).toContain(tell);
    }
  });
});
