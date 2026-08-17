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
  // Was: expect(CRAFT_RULES).toMatch(/never open on a thesis/i).
  //
  // That rule was wrong, so the test was wrong with it. "There are no bad marketing
  // channels" is a thesis, and on a short-form timeline it is the strongest opening there
  // is — a claim the reader wants to argue with. Banning theses outright banned that too.
  //
  // What still has to hold is the distinction: a flat claim earns attention, a definition or
  // a question the writer immediately answers does not. Asserting the shapes rather than the
  // sentence, so rewording the guidance does not fail the suite.
  it("permits a contrarian claim as an opening", () => {
    expect(CRAFT_RULES).toMatch(/contrarian claim/i);
  });

  it("still forbids the openings that promise nothing", () => {
    expect(CRAFT_RULES).toMatch(/definition/i);
    expect(CRAFT_RULES).toMatch(/question you are about to answer yourself/i);
  });

  it("bans the phrases the scorer checks for, so prompt and contract agree", () => {
    // If these drifted apart the model would be asked for one thing and graded on another.
    for (const tell of ["in today's", "let's dive in", "game changer"]) {
      expect(AI_TELLS).toContain(tell);
    }
  });
});

describe("the opening check judges the hook, not the whole post", () => {
  // A competitor's post scored badly here and the score was wrong, not the post:
  //
  //   there are no bad marketing channels
  //   it's either / - your icp doesn't hang out there / ...
  //   the channel is rarely a problem
  //
  // WEAK_OPENINGS matches "there are", so a flat contrarian claim — the strongest opening
  // available on a short-form timeline — was being filed alongside "there are many ways to".
  // The exception is deliberately narrow: negated, and short enough to read as an assertion.
  it("passes a short contrarian claim", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    const post = "there are no bad marketing channels\n\nit's either\n- your icp doesn't hang out on that channel\n- you're using it at the wrong time\n\nthe channel is rarely a problem";
    expect(scoreDraft(post).issues.some((i) => i.code === "weak_opening")).toBe(false);
  });

  it("passes other negated openers", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    const post = "nobody reads your case studies\n\nthey skim the logo wall and leave\n\nput the company size in the headline";
    expect(scoreDraft(post).issues.some((i) => i.code === "weak_opening")).toBe(false);
  });

  it("still flags the affirmative version, which is filler", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    const post = "there are many ways to improve your marketing this year.\nEach takes effort. Let us look at a few.";
    expect(scoreDraft(post).issues.some((i) => i.code === "weak_opening")).toBe(true);
  });

  it("still flags a long hedged opener wearing the same clothes", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    const post = "There is no doubt whatsoever that in the current landscape of modern digital marketing every business must consider how it approaches its audience.\nThis is something we all know.";
    expect(scoreDraft(post).issues.some((i) => i.code === "weak_opening")).toBe(true);
  });

  // The bug behind the bug: these posts carry no terminal punctuation, so the sentence
  // splitter returned the entire post as sentence one. Any length test on it was measuring
  // the whole post, and the hook was being judged by the words of every line beneath it.
  it("reads the first line as the opener when the post has no full stops", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    const post = "there are no bad marketing channels\n\n" + "a much longer line that would blow any word cap ".repeat(6);
    expect(scoreDraft(post).issues.some((i) => i.code === "weak_opening")).toBe(false);
  });
});

describe("shape, not just sentences", () => {
  // flat_rhythm catches prose running at one sentence length. Nothing caught prose with no
  // structure at all, so every post came out as three paragraphs of good writing — and a feed
  // of well-written identical blocks reads as one post repeated. That sameness, not the
  // wording, is what makes generated content feel lifeless.
  const wall = "Most founders treat every channel as equally viable when they start out and that assumption quietly costs them a quarter. The honest answer is that your buyers already gather somewhere specific and everything else is a rounding error on your attention. Finding that place takes a week of asking rather than a quarter of posting everywhere and hoping.";

  it("flags a wall of prose", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    expect(scoreDraft(wall).issues.some((i) => i.code === "monotone_shape")).toBe(true);
  });

  it("clears the same argument once it has a shape", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    const shaped = "Most founders treat every channel as equally viable.\n\nThat assumption costs a quarter.\n\nYour buyers already gather somewhere specific. Everything else is a rounding error.\n\nAsk for a week instead of posting for a quarter.";
    expect(scoreDraft(shaped).issues.some((i) => i.code === "monotone_shape")).toBe(false);
  });

  it("accepts a list as a shape", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    const list = "there are no bad marketing channels\n\nit's either\n- your icp isn't there\n- your timing is wrong\n- your offer is wrong\n\nthe channel is rarely the problem";
    expect(scoreDraft(list).issues.some((i) => i.code === "monotone_shape")).toBe(false);
  });

  it("leaves short posts alone", async () => {
    // Under ~40 words a single block is a deliberate choice, not a wall.
    const { scoreDraft } = await import("@/lib/content/craft");
    const short = "Nobody reads your case studies. They skim the logo wall and leave.";
    expect(scoreDraft(short).issues.some((i) => i.code === "monotone_shape")).toBe(false);
  });

  it("tells the model what to do about it", async () => {
    const { scoreDraft, rewriteNote } = await import("@/lib/content/craft");
    expect(rewriteNote(scoreDraft(wall))).toMatch(/wall of prose/i);
  });

  it("offers shapes and a real question, and still bans engagement bait", async () => {
    const { POST_SHAPES, INTERACTION, CRAFT_BANS } = await import("@/lib/content/craft");
    // Six shapes so paragraphs stop being the default.
    for (const shape of ["The claim", "The list", "The walkthrough", "The receipt", "The comparison", "The picture"]) {
      expect(POST_SHAPES, `${shape} missing`).toContain(shape);
    }
    // The interaction rule has to survive alongside the rhetorical-question ban without
    // contradicting it: a question you answer yourself is bait, one a stranger answers is not.
    expect(INTERACTION).toMatch(/real question/i);
    expect(INTERACTION).toMatch(/never "thoughts\?"/i);
    expect(CRAFT_BANS).toMatch(/Rhetorical questions/i);
  });
});

describe("a fatal fault actually triggers a rewrite", () => {
  // A real generation came back as 54 words in one unbroken line. monotone_shape flagged it,
  // the score was 0.90, and needsRewrite was false — the check fired and nothing acted on it,
  // because needsRewrite was only ever a penalty total. Accumulating small blemishes is not
  // the only way to be unpublishable; one structural fault is enough.
  const wall = "Founders often pour a whole quarter into posting across every social, email, and ad platform, only to learn that their ideal buyers gather in a single unexpected channel. The cost is missed revenue and wasted budget. Reframe your messaging and stop the scattershot approach.";

  it("sends a single-paragraph wall back even when nothing else is wrong", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    const s = scoreDraft(wall);
    expect(s.issues.some((i) => i.code === "monotone_shape")).toBe(true);
    expect(s.score).toBeGreaterThan(0.5);   // otherwise clean — the point of the case
    expect(s.needsRewrite).toBe(true);
  });

  it("still leaves genuinely good writing alone", async () => {
    const { scoreDraft } = await import("@/lib/content/craft");
    const good = "You waste a quarter posting everywhere, only to learn your buyers live in one spot.\n\n- flat metrics on three platforms\n- your buyer reads one forum\n- double down there\n\nWhich one actually drives your sales?";
    expect(scoreDraft(good).needsRewrite).toBe(false);
  });
});
