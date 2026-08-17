// Craft rules for written content.
//
// The composer already refuses to invent statistics and cuts hype adjectives. That stops
// content being *wrong*. It does nothing to stop it being *unread*, which is the more common
// fate — a post that is accurate, on-brand, grounded in real context, and that nobody
// finishes because the first line is a thesis statement.
//
// This file is about the difference. Two halves:
//
//   Rules that go into the prompt, teaching the moves that make writing land.
//   A deterministic scorer that checks the result, because a prompt is a request and a
//   check is a contract. Anything the scorer can catch, it catches — no second model call
//   asked to grade the first one.
//
// The single organising idea: **AI writes the summary of a post; a person writes the post.**
// Almost every rule below is a specific instance of that.

/* ────────────────────────────────────────────────────────────────────────────
   Things that mark writing as machine-made.
   Not style preferences — these are the phrases that make a reader stop reading
   because they have seen a thousand of them this month.
   ──────────────────────────────────────────────────────────────────────────── */

export const AI_TELLS: string[] = [
  // openers that say nothing
  "in today's", "in the world of", "in the fast-paced", "in an era where",
  "let's dive in", "let's face it", "let's be honest", "here's the thing",
  "picture this", "imagine a world", "we've all been there",
  // LinkedIn throat-clearing
  "i'm excited to", "i'm thrilled to", "thrilled to announce", "excited to share",
  "humbled to", "grateful to announce", "big news",
  // the engagement-bait tics
  "let that sink in", "read that again", "the results speak for themselves",
  "game changer", "game-changer", "no-brainer", "secret sauce", "the truth is",
  "and that's a wrap", "food for thought", "just my two cents",
  // straight from a post that reached a customer
  "we've got you covered", "we have you covered", "don't worry", "but don't worry",
  "you'll be well on your way", "well on your way to",
  // hedging that removes all content
  "it's important to note", "it's worth noting", "at the end of the day",
  "when it comes to", "the key takeaway", "in conclusion", "to sum up",
  // corporate filler
  "leverage", "utilize", "synergy", "best-in-class", "cutting-edge", "seamless",
  "robust solution", "unlock the power", "supercharge", "revolutionize",
  "take it to the next level", "move the needle", "circle back",
  // the closing that summarises what was just said
  "so there you have it", "remember, it's all about", "happy posting",
];

/** Phrases that reveal the writer never had a specific in mind. */
export const VAGUE_CLAIMS: string[] = [
  "studies show", "research suggests", "experts agree", "it is well known",
  "many people", "most businesses", "countless", "numerous studies",
];

/* ────────────────────────────────────────────────────────────────────────────
   The prompt block.
   ──────────────────────────────────────────────────────────────────────────── */

export const CRAFT_RULES = `HOW TO WRITE IT

The first line decides whether the rest is read. Two openings earn attention, and nothing
else does.

One: something concrete — a specific moment, an actual number from the context, a thing that
broke, a sentence someone really said.

Two: a flat contrarian claim the reader will want to argue with. "There are no bad marketing
channels." "Nobody reads your case studies." State it and stop; do not soften it, do not
hedge it, do not explain it in the same sentence. Then earn it in the lines below.

Never open on a definition, on a question you are about to answer yourself, or on a thesis
you immediately restate. If your first sentence would work as the summary of the post,
delete it and start at the second.

Have one point. A post that makes three arguments makes none — pick the sharpest and cut
the others, however true they are.

Vary the rhythm. Machine writing runs at one length: fourteen words, fourteen words,
fourteen words. Put a four-word sentence after a long one. Let a paragraph be a single line
when the line earns it.

Say the uncomfortable part. The posts people forward are the ones that admit a cost, name a
tradeoff, or disagree with something the reader already believes. Safe writing is forgettable
writing — but never manufacture a controversy the business does not actually hold.

Earn the ending. Do not summarise what you just said; the reader was there. End on the
sharpest line, a real question, or simply stop.

Write like one person talking to one person. No "businesses today". No "we all know".
Second person, plain verbs, contractions where they fall naturally.

Concrete beats clever. One real detail from the context above is worth more than any
turn of phrase.`;

export const CRAFT_BANS = `NEVER WRITE

- These phrases, in any form: ${AI_TELLS.slice(0, 24).join("; ")}.
- Any variant of "studies show" or "experts agree" — if you have no source, make the argument without one.
- Rhetorical questions you immediately answer ("So what does this mean? It means…").
- A closing summary of the post the reader has just read.
- Emoji as bullet points, or more than one emoji in total.
- Hashtag stacks. Two, at most, and only where the platform expects them.
- The word "content" to describe what you are writing.`;

/* ────────────────────────────────────────────────────────────────────────────
   Platform form. Length is the least of the differences between these.
   ──────────────────────────────────────────────────────────────────────────── */

export const PLATFORM_FORM: Record<string, string> = {
  x: `X: the first sentence is the whole bet — it appears alone in a timeline. No preamble, no setup. One idea. Lowercase openings are fine. No hashtags.`,
  linkedin: `LinkedIn: the first two lines show before "see more", so the hook has to survive being cut there. Short paragraphs, one or two lines each, with real line breaks. A specific story or number beats a lesson. No hashtag stack, no "thoughts?" sign-off.`,
  reddit: `Reddit: you are a person in a thread, not a brand. Lead with the answer or the experience, not context. Mention the product only if it is genuinely the answer, and disclose the connection plainly. Any marketing cadence gets the post removed and the account remembered.`,
  instagram: `Instagram: the caption's first line carries it. Conversational, present tense, no corporate rhythm. Line breaks between thoughts.`,
  facebook: `Facebook: plainer and warmer than LinkedIn. Write the way you would to someone who does not work in this industry.`,
  threads: `Threads: closer to X than Instagram. Conversational, short, one idea, no hashtags.`,
  tiktok: `TikTok: this is spoken, not read. Write for a mouth — the first three seconds have to earn the next three.`,
  youtube: `YouTube: the first sentence promises what the viewer gets. No channel-intro throat-clearing.`,
};

/** The form guidance for whichever platforms are in play. */
export function formFor(platforms: string[]): string {
  const lines = platforms.map((p) => PLATFORM_FORM[p]).filter(Boolean);
  return lines.length ? `PLATFORM FORM\n${lines.join("\n")}` : "";
}

/* ────────────────────────────────────────────────────────────────────────────
   The deterministic check.

   A prompt asks; this enforces. Everything here is checkable without a model,
   which is what makes it a contract rather than a hope — and it means a bad
   draft is caught before a founder reads it rather than after.
   ──────────────────────────────────────────────────────────────────────────── */

export type CraftIssue = {
  code: "ai_tell" | "vague_claim" | "flat_rhythm" | "summary_ending" | "hashtag_stack" | "emoji_spam" | "weak_opening";
  detail: string;
};

export type CraftScore = {
  /** 0..1. Not a quality score — a count of things known to be wrong. */
  score: number;
  issues: CraftIssue[];
  /** Whether this is bad enough to be worth spending another generation on. */
  needsRewrite: boolean;
};

const sentences = (t: string) =>
  t.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/** Openers that promise the reader nothing. */
const WEAK_OPENINGS = /^(in|as|with|when|if|the|there (is|are)|it (is|was)|we (all|know)|have you ever|did you know|are you (tired|looking|struggling))\b/i;

/**
 * The exception that keeps the rule honest: a flat denial is not throat-clearing.
 *
 * "there are no bad marketing channels" was being flagged as a weak opening because the
 * pattern above matches "there are". But that sentence is the strongest move available on a
 * short-form timeline — a claim stated without hedging that a reader will immediately want
 * to argue with. "there are many ways to improve your marketing" is the weak one, and the
 * two are identical to the regex.
 *
 * The distinguishing feature is negation. "There is no", "there are no", "nobody", "none of"
 * commit to a position; the affirmative versions announce that a list is coming.
 *
 * Deliberately narrow: only the negated forms of the openers already listed, and only when
 * the sentence is short enough to read as an assertion rather than a preamble.
 */
const CONTRARIAN_OPENING = /^(there (is|are) (no|nothing|not)\b|no ?one\b|nobody\b|none of\b|it (is|was) never\b)/i;

export function scoreDraft(text: string): CraftScore {
  const t = (text || "").trim();
  const issues: CraftIssue[] = [];
  if (!t) return { score: 0, issues: [{ code: "weak_opening", detail: "empty" }], needsRewrite: true };

  const lower = t.toLowerCase();

  for (const tell of AI_TELLS) {
    if (lower.includes(tell)) issues.push({ code: "ai_tell", detail: tell });
  }
  for (const vague of VAGUE_CLAIMS) {
    if (lower.includes(vague)) issues.push({ code: "vague_claim", detail: vague });
  }

  const sents = sentences(t);

  // A first line that opens on a preposition or a "did you know" is a first line that could
  // belong to any post about anything.
  // Judge the opening on the first *line*, not the first sentence.
  //
  // Short-form posts are broken by newlines and frequently carry no terminal punctuation at
  // all — the sentence splitter then returns the whole post as one "sentence". That made the
  // length test below meaningless and, worse, judged a one-line hook by the words of every
  // line under it. What the reader sees first is the first line; that is what has to work.
  const firstLine = t.split("\n").map((l) => l.trim()).find(Boolean) || "";
  const opener = firstLine || sents[0] || "";

  // The length cap matters: "there is no silver bullet" is an assertion, while a 30-word
  // line starting "there is no doubt that…" is preamble wearing the same clothes.
  const contrarian = CONTRARIAN_OPENING.test(opener) && opener.split(/\s+/).length <= 14;
  if (opener && WEAK_OPENINGS.test(opener) && !contrarian) {
    issues.push({ code: "weak_opening", detail: opener.slice(0, 60) });
  }

  // Uniform sentence length is the most reliable signal of machine prose. Real writing
  // varies; a standard deviation under ~4 words across enough sentences does not happen
  // by accident.
  if (sents.length >= 4) {
    const lens = sents.map((s) => s.split(/\s+/).length);
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    if (sd < 3.6) issues.push({ code: "flat_rhythm", detail: `sd ${sd.toFixed(1)} over ${lens.length} sentences` });
  }

  // Closing summary.
  const tail = sents.slice(-2).join(" ").toLowerCase();
  if (/^(so|in short|to recap|overall|ultimately|in summary)\b/.test(tail) || /\b(in conclusion|to sum up|the takeaway)\b/.test(tail)) {
    issues.push({ code: "summary_ending", detail: tail.slice(0, 60) });
  }

  const hashtags = (t.match(/#\w+/g) || []).length;
  if (hashtags > 2) issues.push({ code: "hashtag_stack", detail: `${hashtags} hashtags` });

  const emoji = (t.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
  if (emoji > 1) issues.push({ code: "emoji_spam", detail: `${emoji} emoji` });

  // Weighted: a fabricated-sounding claim is worse than a flat rhythm.
  const weight = (c: CraftIssue["code"]) =>
    c === "vague_claim" ? 3 : c === "ai_tell" ? 2 : c === "weak_opening" ? 2 : 1;
  const penalty = issues.reduce((n, i) => n + weight(i.code), 0);
  const score = Math.max(0, 1 - penalty / 10);

  return { score: Number(score.toFixed(2)), issues, needsRewrite: penalty >= 4 };
}

/** What to tell the model when asking it to try again. Names the faults, not the vibe. */
export function rewriteNote(s: CraftScore): string {
  const byCode = new Map<string, string[]>();
  for (const i of s.issues) byCode.set(i.code, [...(byCode.get(i.code) || []), i.detail]);

  const parts: string[] = [];
  const tells = byCode.get("ai_tell");
  if (tells) parts.push(`Remove these phrases entirely: ${tells.join(", ")}.`);
  const vague = byCode.get("vague_claim");
  if (vague) parts.push(`Remove unsourced claims (${vague.join(", ")}) — make the argument without them.`);
  if (byCode.has("weak_opening")) parts.push(`The opening line is generic. Start on a concrete specific instead.`);
  if (byCode.has("flat_rhythm")) parts.push(`Every sentence is the same length. Break it up — put a short one after a long one.`);
  if (byCode.has("summary_ending")) parts.push(`Cut the closing summary. End on the sharpest line.`);
  if (byCode.has("hashtag_stack")) parts.push(`Two hashtags at most.`);
  if (byCode.has("emoji_spam")) parts.push(`One emoji at most.`);

  return parts.join(" ");
}
