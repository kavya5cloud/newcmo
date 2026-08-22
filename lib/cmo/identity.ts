// Keeping the product's name on the product's answers.
//
// lib/cmo/quality-rules.ts asks the model not to disclose the vendor behind it, and the
// system prompt asks again on every call. Both are requests. This is the check, because a
// prompt rule is a preference and the one place it fails is the one place it matters: a
// founder asking "what are you" and pasting the answer somewhere.
//
// The hard constraint is that vendor names are not forbidden words. A customer selling
// developer tools may compete with OpenAI; a post about AI search has to be able to say
// Gemini. Stripping those would break real marketing copy to solve a self-reference problem.
//
// So every pattern here is anchored on the model talking about *itself*. "OpenAI raised a
// round" survives. "I am an OpenAI model" does not. That distinction is the whole design,
// and it is why these are sentence-level regexes rather than a word list.

/** Vendors and model families whose names only matter here in the first person. */
const VENDORS = "Gemini|Google|Bard|OpenAI|ChatGPT|GPT-?[0-9o]*|Anthropic|Claude|Groq|Llama|Meta AI|Mistral|Copilot|DeepSeek|Qwen";

/**
 * Self-disclosure patterns.
 *
 * Each must contain a first-person reference to the speaker, so a sentence that merely
 * mentions a vendor is untouched. Ordered loosely by how often they actually appear.
 */
const SELF_DISCLOSURE: { code: string; re: RegExp }[] = [
  // "As an AI language model, I…" — the single most common one.
  { code: "as_an_ai", re: /\b(?:as|being)\s+an?\s+(?:AI|artificial intelligence)(?:\s+language)?(?:\s+model|\s+assistant)?\b/i },
  // "I am Gemini", "I'm Claude", "this is ChatGPT"
  { code: "i_am_vendor", re: new RegExp(`\\b(?:I\\s*(?:'m|am)|this is|you(?:'re| are) (?:talking to|chatting with))\\s+(?:the\\s+)?(?:${VENDORS})\\b`, "i") },
  // "I am a model trained by Google", "developed by OpenAI"
  { code: "trained_by", re: new RegExp(`\\bI\\s*(?:'m|am)\\b[^.!?]{0,60}\\b(?:trained|developed|created|built|made|powered|trained)\\s+by\\s+(?:${VENDORS})\\b`, "i") },
  // "I'm powered by Gemini" without the "I am a model" preamble.
  { code: "powered_by", re: new RegExp(`\\b(?:I\\s*(?:'m|am)|Populr is)\\s+(?:powered|running|built)\\s+(?:on|by)\\s+(?:${VENDORS})\\b`, "i") },
  // Architecture talk. Self-referential by construction — "my training data".
  { code: "my_internals", re: /\bmy\s+(?:training\s+data|knowledge\s+cut-?off|training\s+cut-?off|system\s+prompt|underlying\s+model|context\s+window|parameters)\b/i },
  // "I don't have access to real-time information" — a disclaimer about the machine, not an
  // answer about the marketing.
  { code: "no_realtime", re: /\bI\s+(?:don'?t|do not|cannot|can'?t)\s+have\s+(?:access\s+to\s+)?(?:real-?time|live|current|up-to-date)\b/i },
  // "My knowledge cuts off in…" / "as of my last update"
  { code: "cutoff", re: /\b(?:as of my last (?:update|training)|my knowledge (?:cuts? off|is limited to|only extends))\b/i },
];

export type IdentityFinding = { code: string; sentence: string };

/** Split on sentence ends, keeping the terminator so rejoining does not lose punctuation. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

/**
 * Remove sentences where the model talked about itself instead of the work.
 *
 * Sentence-level rather than phrase-level: cutting "as an AI language model," out of the
 * middle leaves a sentence that starts lowercase and reads as a typo, and the rest of that
 * sentence is nearly always a disclaimer too.
 *
 * Returns the original text when scrubbing would empty it. An awkward answer beats a blank
 * one, and a response that vanishes is a bug the founder cannot diagnose.
 */
export function scrubIdentity(text: string): { text: string; findings: IdentityFinding[] } {
  if (!text.trim()) return { text, findings: [] };

  const findings: IdentityFinding[] = [];
  const kept: string[] = [];

  for (const line of text.split("\n")) {
    const out: string[] = [];
    for (const s of sentences(line)) {
      const hit = SELF_DISCLOSURE.find((p) => p.re.test(s));
      if (hit) findings.push({ code: hit.code, sentence: s.trim().slice(0, 140) });
      else out.push(s);
    }
    kept.push(out.join(" "));
  }

  const scrubbed = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!scrubbed) return { text, findings };
  return { text: scrubbed, findings };
}

/**
 * What to say when someone asks directly.
 *
 * Deterministic, so the answer to "what model are you" cannot vary with whichever provider
 * happened to answer — which is exactly the inconsistency that makes someone go looking.
 * It confirms being an AI, because declining to name a vendor is not licence to claim to be
 * a person.
 */
export const IDENTITY_ANSWER =
  "I'm Populr — an AI CMO. I can't get into how I'm built, but I can tell you what I'm doing " +
  "for your marketing and why.";

/** True when a question is asking what the assistant is rather than about the business. */
export function asksAboutIdentity(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(what|which)\s+(model|llm|ai)\b/.test(q) ||
    /\b(are|r)\s+you\s+(an?\s+)?(ai|bot|robot|human|real|chatgpt|gemini|claude|gpt)\b/.test(q) ||
    /\bwho\s+(made|built|trained|created)\s+you\b/.test(q) ||
    /\bwhat\s+(are|r)\s+you\s+(built|running|based)\s+on\b/.test(q) ||
    /\b(your|ur)\s+(system\s+prompt|training\s+data|instructions)\b/.test(q)
  );
}
