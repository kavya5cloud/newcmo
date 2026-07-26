import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/social/types";

// Launch Workspace command bar — deterministic natural-language → intent parsing.
//
// Deliberately not an LLM call: the command bar drives real side effects (scheduling,
// publishing, generation), so it must be predictable, testable and instant. Anything it
// can't parse confidently is reported as `unknown` with the commands it does understand,
// rather than guessed at.

export const COMMAND_INTENTS = [
  "launch_product", "create_campaign", "generate_assets",
  "schedule_all", "publish_now", "pause_all", "research_market", "unknown",
] as const;
export type CommandIntent = (typeof COMMAND_INTENTS)[number];

export type ParsedCommand = {
  intent: CommandIntent;
  /** Human-readable restatement of what will happen — shown before anything runs. */
  summary: string;
  params: {
    timelineDays?: number;
    quantity?: number;
    platform?: SocialPlatform;
    subject?: string;
  };
};

export const COMMAND_EXAMPLES = [
  "Launch my product next week",
  "Create a campaign for the beta waitlist",
  "Generate 10 LinkedIn posts",
  "Schedule everything",
];

const PLATFORM_WORDS: Record<string, SocialPlatform> = {
  linkedin: "linkedin", instagram: "instagram_business", ig: "instagram_business",
  facebook: "facebook_pages", fb: "facebook_pages", x: "x", twitter: "x",
  threads: "threads", pinterest: "pinterest",
};

/** "next week" → 7, "in 3 weeks" → 21, "in 10 days" → 10, "tomorrow" → 1. */
function parseHorizon(s: string): number | undefined {
  if (/\btomorrow\b/.test(s)) return 1;
  if (/\bnext week\b/.test(s)) return 7;
  if (/\bnext month\b/.test(s)) return 30;
  const weeks = s.match(/\bin (\d{1,2}) weeks?\b/);
  if (weeks) return Number(weeks[1]) * 7;
  const days = s.match(/\bin (\d{1,3}) days?\b/);
  if (days) return Number(days[1]);
  return undefined;
}

function parsePlatform(s: string): SocialPlatform | undefined {
  for (const [word, platform] of Object.entries(PLATFORM_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(s)) return platform;
  }
  return undefined;
}

function parseQuantity(s: string): number | undefined {
  const m = s.match(/\b(\d{1,3})\b/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n > 0 && n <= 100 ? n : undefined;
}

export function parseCommand(input: string): ParsedCommand {
  const s = input.toLowerCase().trim();
  const timelineDays = parseHorizon(s);
  const platform = parsePlatform(s);
  const quantity = parseQuantity(s);

  if (/\b(launch|ship|go live)\b/.test(s) && !/\bcampaign\b/.test(s)) {
    const days = timelineDays ?? 28;
    return {
      intent: "launch_product",
      summary: `Re-time the launch to ${days} day${days === 1 ? "" : "s"} and rebuild the timeline.`,
      params: { timelineDays: days },
    };
  }

  if (/\bcreate\b.*\bcampaign\b|\bnew campaign\b|\badd a campaign\b/.test(s)) {
    const subject = input.replace(/.*campaign\s*(for|about|to)?\s*/i, "").trim() || undefined;
    return {
      intent: "create_campaign",
      summary: subject ? `Draft a campaign for "${subject}".` : "Draft a new campaign in the current launch.",
      params: { subject },
    };
  }

  if (/\bgenerate|write|draft|make\b/.test(s) && /\bposts?|assets?|creatives?|content\b/.test(s)) {
    const n = quantity ?? 5;
    const where = platform ? ` for ${platform}` : "";
    return {
      intent: "generate_assets",
      summary: `Generate ${n} post${n === 1 ? "" : "s"}${where} and add them to the asset library.`,
      params: { quantity: n, platform },
    };
  }

  if (/\bschedule\b/.test(s)) {
    return {
      intent: "schedule_all",
      summary: /\beverything|all\b/.test(s)
        ? "Schedule every unscheduled item on the plan's publishing slots."
        : "Schedule the selected items on the plan's publishing slots.",
      params: { platform },
    };
  }

  if (/\bpublish\b/.test(s)) {
    return { intent: "publish_now", summary: "Advance approved items into the publishing queue.", params: { platform } };
  }

  if (/\bpause|stop|hold\b/.test(s)) {
    return { intent: "pause_all", summary: "Pause every in-progress item. Nothing is deleted.", params: {} };
  }

  if (/\bresearch|trends?|competitors?|market|opportunit/.test(s)) {
    return { intent: "research_market", summary: "Run a market research pass and refresh the intelligence panel.", params: { subject: input.trim() } };
  }

  return {
    intent: "unknown",
    summary: `I can't act on that yet. Try: ${COMMAND_EXAMPLES.join(" · ")}`,
    params: {},
  };
}

export function isSocialPlatform(v: unknown): v is SocialPlatform {
  return typeof v === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(v);
}
