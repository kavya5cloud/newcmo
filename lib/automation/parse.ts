import type { SocialPlatform } from "@/lib/social/types";
import type { Cadence, ContentSource, Weekday } from "./types";

// Turning "3 LinkedIn posts every week, 2 X posts daily, and an Instagram carousel every
// Friday" into automations.
//
// Deterministic parsing, not a model call — the same reason the command bar is
// deterministic: this creates recurring publishing, so it has to be predictable, testable
// and instant. Anything it can't parse confidently is returned as an unparsed clause with
// the reason, rather than guessed at. A misread cadence publishes for months.

export type ParsedClause = {
  ok: true;
  platform: SocialPlatform;
  cadence: Cadence;
  source: ContentSource;
  /** The clause text this came from, for display next to the rule. */
  text: string;
} | {
  ok: false;
  text: string;
  reason: string;
};

const PLATFORM_WORDS: { re: RegExp; platform: SocialPlatform }[] = [
  { re: /\blinked\s?in\b/i, platform: "linkedin" },
  { re: /\binstagram\b|\big\b/i, platform: "instagram_business" },
  { re: /\bfacebook\b|\bfb\b/i, platform: "facebook_pages" },
  { re: /\bthreads\b/i, platform: "threads" },
  { re: /\bpinterest\b/i, platform: "pinterest" },
  { re: /\b(x|twitter)\b/i, platform: "x" },
];

const WEEKDAYS: { re: RegExp; day: Weekday }[] = [
  { re: /\bsundays?\b/i, day: 0 }, { re: /\bmondays?\b/i, day: 1 },
  { re: /\btuesdays?\b/i, day: 2 }, { re: /\bwednesdays?\b/i, day: 3 },
  { re: /\bthursdays?\b/i, day: 4 }, { re: /\bfridays?\b/i, day: 5 },
  { re: /\bsaturdays?\b/i, day: 6 },
];

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** "3", "three", "a" → a count. Absent → 1, because "an Instagram carousel" means one. */
function readCount(clause: string): number {
  const digits = clause.match(/\b(\d{1,2})\b/);
  if (digits) return Math.max(1, Math.min(50, Number(digits[1])));
  for (const [word, n] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(clause)) return n;
  }
  return 1;
}

function readPlatform(clause: string): SocialPlatform | null {
  for (const { re, platform } of PLATFORM_WORDS) if (re.test(clause)) return platform;
  return null;
}

function readCadence(clause: string, count: number): Cadence | null {
  const days = WEEKDAYS.filter(({ re }) => re.test(clause)).map(({ day }) => day);

  // A named day is a weekly cadence even without the word "week" — "every Friday".
  if (days.length) return { kind: "weekly", count, days };

  if (/\b(dai?ly|every\s+day|each\s+day|per\s+day|a\s+day)\b/i.test(clause)) {
    return { kind: "daily", count, days: [] };
  }
  if (/\b(weekly|every\s+week|each\s+week|per\s+week|a\s+week)\b/i.test(clause)) {
    return { kind: "weekly", count, days: [] };
  }
  if (/\b(monthly|every\s+month|each\s+month|per\s+month|a\s+month)\b/i.test(clause)) {
    const dom = clause.match(/\bon\s+the\s+(\d{1,2})\b/);
    return { kind: "monthly", count, days: [], dayOfMonth: dom ? Number(dom[1]) : 1 };
  }
  const rrule = clause.match(/\bRRULE:[^\s,]+/i);
  if (rrule) return { kind: "custom", count, days: [], rrule: rrule[0] };
  return null;
}

/** Content type words that imply where the content should come from. */
function readSource(clause: string): ContentSource {
  if (/\bcarousel|image|video|reel\b/i.test(clause)) return "content_library";
  if (/\bugc|testimonial|creator\b/i.test(clause)) return "ugc_library";
  if (/\bdraft/i.test(clause)) return "drafts";
  if (/\bcampaign/i.test(clause)) return "campaigns";
  if (/\btemplate/i.test(clause)) return "templates";
  // Default: Populr writes it when the slot comes up. That is the point of automation.
  return "ai_queue";
}

/** Split on commas and "and", which is how people actually list cadences. */
export function splitClauses(input: string): string[] {
  return input
    .split(/,|\band\b|\bplus\b|;/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
}

export function parseClause(clause: string): ParsedClause {
  const platform = readPlatform(clause);
  if (!platform) {
    return { ok: false, text: clause, reason: "No platform named — say which of LinkedIn, X, Instagram, Facebook, Threads or Pinterest." };
  }
  const count = readCount(clause);
  const cadence = readCadence(clause, count);
  if (!cadence) {
    return { ok: false, text: clause, reason: "No cadence found — add daily, weekly, monthly, or a day like “every Friday”." };
  }
  return { ok: true, platform, cadence, source: readSource(clause), text: clause };
}

export type ParseResult = {
  clauses: ParsedClause[];
  /** True when at least one clause produced a usable automation. */
  any: boolean;
};

/**
 * Parse a full instruction into per-platform automations.
 *
 * Clauses are independent: one unparseable clause does not discard the ones that worked,
 * because losing two good rules to fix a typo in a third is a bad trade.
 */
export function parseAutomations(input: string): ParseResult {
  const clauses = splitClauses(input).map(parseClause);
  return { clauses, any: clauses.some((c) => c.ok) };
}
