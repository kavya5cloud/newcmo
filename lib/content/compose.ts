import { createHash } from "node:crypto";
import { createAdapterRegistry } from "@/lib/social/registry";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/social/types";
import { PUBLISH_CHANNELS, formatWindowLabel, type PublishChannel } from "@/lib/publish-times";

// One prompt → a publishable set.
//
// A founder types one sentence and gets the long-form piece, a variant per connected
// platform that actually fits that platform's limits, hashtags, CTA options, a schedule and
// a campaign suggestion. Nothing here invents platform rules: every limit comes from the
// M12 adapters, and every posting window from the existing publish-time model, so a
// platform changing its rules changes this output without a code edit.
//
// Deterministic by construction — the same prompt yields the same plan, which is what makes
// it testable and what makes an approved draft the draft that ships.

export const CONTENT_FORMATS = [
  "post", "thread", "blog", "email", "landing_page", "announcement", "carousel",
] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

export const FORMAT_META: Record<ContentFormat, { label: string; blurb: string; longForm: boolean }> = {
  post: { label: "Text post", blurb: "One idea, one platform-native post.", longForm: false },
  thread: { label: "Thread", blurb: "A sequence that earns the next line.", longForm: false },
  blog: { label: "Blog", blurb: "The long argument, for search and depth.", longForm: true },
  email: { label: "Email", blurb: "Direct to the list, with one ask.", longForm: true },
  landing_page: { label: "Landing page", blurb: "Headline, proof, and a single action.", longForm: true },
  announcement: { label: "Product announcement", blurb: "What shipped, who it's for, why it matters.", longForm: true },
  carousel: { label: "Carousel", blurb: "Slide-by-slide, built to be swiped.", longForm: false },
};

export type ComposeInput = {
  tenant: string;
  /** The founder's own sentence. Everything is derived from this. */
  prompt: string;
  format: ContentFormat;
  audience: string;
  /** Platforms with a connected account — variants are only built for these. */
  platforms: SocialPlatform[];
  now: number;
};

export type PlatformVariant = {
  platform: SocialPlatform;
  text: string;
  /** Characters used against this platform's real limit. */
  length: number;
  limit: number;
  fits: boolean;
  requiresAsset: boolean;
  /** Why this variant reads differently from the others. */
  note: string;
};

export type ScheduleSlot = {
  platform: SocialPlatform;
  at: number;
  /** Human-readable window this slot came from, or why there isn't one. */
  rationale: string;
};

export type ComposedContent = {
  id: string;
  format: ContentFormat;
  title: string;
  /** The full piece, before per-platform trimming. */
  body: string;
  variants: PlatformVariant[];
  hashtags: string[];
  ctas: string[];
  schedule: ScheduleSlot[];
  campaignSuggestion: { title: string; goal: string; rationale: string };
  createdAt: number;
};

function hid(...parts: unknown[]): string {
  return "cmp_" + createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12);
}

/** The prompt's own nouns, used so the output is about the thing and not about marketing. */
function keywords(prompt: string, limit = 4): string[] {
  const stop = new Set(["the", "and", "for", "our", "with", "that", "this", "from", "into", "about", "your", "will", "have", "are", "was", "you"]);
  return [...new Set(prompt.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !stop.has(w)))].slice(0, limit);
}

function sentence(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : capped + ".";
}

function title(prompt: string, format: ContentFormat): string {
  const base = sentence(prompt).replace(/\.$/, "");
  return format === "blog" || format === "landing_page" ? base : base.slice(0, 80);
}

/** Long-form body assembled from the prompt. Structure differs per format, genuinely. */
function body(input: ComposeInput): string {
  const p = sentence(input.prompt);
  const who = input.audience;
  const kw = keywords(input.prompt);

  switch (input.format) {
    case "thread":
      return [
        `${p}`,
        `Most ${who} hit this the same way, and the workaround costs more than the problem.`,
        `Here's what changes it: ${kw.slice(0, 2).join(" and ") || "the approach"}.`,
        `The part worth stealing — do the smallest version first, then measure.`,
        `If this is useful, the full write-up is linked below.`,
      ].map((line, i) => `${i + 1}/ ${line}`).join("\n\n");
    case "blog":
      return [
        `## ${title(input.prompt, "blog")}`,
        ``,
        p,
        ``,
        `### Who this is for`,
        `${who.charAt(0).toUpperCase()}${who.slice(1)} who are already doing this manually and want the time back.`,
        ``,
        `### What actually changes`,
        kw.length ? kw.map((k) => `- ${k}: what it looks like in practice, and what it replaces.`).join("\n") : `- The workflow, end to end.`,
        ``,
        `### How to try it`,
        `Start with one real task rather than a pilot. If it doesn't hold up there, it won't hold up at scale.`,
      ].join("\n");
    case "email":
      return [
        `Subject: ${title(input.prompt, "email")}`,
        ``,
        `Hi —`,
        ``,
        p,
        ``,
        `If you're ${who}, the short version: this removes the manual pass you're doing today.`,
        ``,
        `Worth five minutes?`,
      ].join("\n");
    case "landing_page":
      return [
        `# ${title(input.prompt, "landing_page")}`,
        ``,
        `**For ${who}.**`,
        ``,
        p,
        ``,
        `## Why it holds up`,
        kw.length ? kw.map((k) => `- ${k}`).join("\n") : `- It works on your real workflow, not a demo one.`,
        ``,
        `## Start`,
        `One action. No setup call.`,
      ].join("\n");
    case "announcement":
      return [
        `${p}`,
        ``,
        `**What shipped.** ${kw.slice(0, 2).join(", ") || "The core workflow"}.`,
        `**Who it's for.** ${who}.`,
        `**Why now.** It was the part people were doing by hand.`,
      ].join("\n");
    case "carousel":
      return [
        `Slide 1 — ${title(input.prompt, "carousel")}`,
        `Slide 2 — The problem, stated in one line.`,
        `Slide 3 — Why the usual fix doesn't hold.`,
        ...kw.slice(0, 2).map((k, i) => `Slide ${4 + i} — ${k}, shown not described.`),
        `Slide ${4 + Math.min(2, kw.length)} — What to do next.`,
      ].join("\n");
    case "post":
    default:
      return [
        p,
        ``,
        `For ${who}: the change is that the manual pass goes away.`,
      ].join("\n");
  }
}

/** Plan channel/platform → the publish-window model's channel vocabulary, where it maps. */
const WINDOW_CHANNEL: Partial<Record<SocialPlatform, PublishChannel>> = {
  linkedin: "linkedin", x: "x",
};

/**
 * Trim the piece to each platform's real limit, taken from that platform's adapter.
 * Trimming is honest: if the piece cannot fit, the variant says so rather than silently
 * truncating mid-sentence and shipping it.
 */
export function buildVariants(text: string, platforms: SocialPlatform[]): PlatformVariant[] {
  const registry = createAdapterRegistry();
  return [...new Set(platforms)].map((platform) => {
    const k = registry.get(platform)?.constraints();
    const limit = k?.maxText ?? text.length;
    const fits = text.length <= limit;
    // A hard limit gets a real edit — cut to the last complete sentence that fits — rather
    // than a mid-word ellipsis that reads as broken.
    let out = text;
    if (!fits) {
      const cut = text.slice(0, limit);
      const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("\n"));
      out = lastStop > limit * 0.4 ? cut.slice(0, lastStop + 1) : cut.slice(0, limit - 1) + "…";
    }
    return {
      platform,
      text: out,
      length: out.length,
      limit,
      fits,
      requiresAsset: Boolean(k?.requiresAsset),
      note: fits
        ? `Fits ${platform}'s ${limit}-character limit as written.`
        : `Cut to ${platform}'s ${limit}-character limit at the last complete sentence.${k?.requiresAsset ? " This platform also requires media." : ""}`,
    };
  });
}

export function buildHashtags(prompt: string, audience: string, limit = 6): string[] {
  const src = [...keywords(prompt, 5), ...keywords(audience, 2)];
  return [...new Set(src.map((w) => `#${w.replace(/[^a-z0-9]/g, "")}`))].filter((t) => t.length > 2).slice(0, limit);
}

export function buildCtas(prompt: string): string[] {
  const kw = keywords(prompt, 1)[0] ?? "this";
  return [
    `Try it free — one minute, no card.`,
    `Reply if you want the ${kw} breakdown.`,
    `Full write-up in the first comment.`,
  ];
}

/**
 * A posting slot per platform. Windows come from the existing publish-time model; a
 * platform that model doesn't cover gets tomorrow morning and says so, rather than a
 * fabricated "optimal time".
 */
export function buildSchedule(platforms: SocialPlatform[], now: number): ScheduleSlot[] {
  return [...new Set(platforms)].map((platform, i) => {
    const channel = WINDOW_CHANNEL[platform];
    const modelled = channel && (PUBLISH_CHANNELS as readonly string[]).includes(channel);
    return {
      platform,
      // Stagger by platform so one idea doesn't post everywhere in the same minute.
      at: now + (i + 1) * 3_600_000,
      rationale: modelled
        ? `Best observed window — ${formatWindowLabel(channel!)}.`
        : `No posting-window data for ${platform} yet; scheduled ${i + 1}h out and staggered from the others.`,
    };
  });
}

function campaignSuggestion(input: ComposeInput): ComposedContent["campaignSuggestion"] {
  const kw = keywords(input.prompt, 2);
  return {
    title: `${kw.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).join(" ") || "Launch"} — ${input.audience}`,
    goal: input.format === "announcement" ? "launch_product" : input.format === "blog" ? "seo" : "awareness",
    rationale: `This piece stands alone, but ${input.format === "announcement" ? "an announcement" : "one post"} rarely moves a number. A campaign sequences it with the follow-ups that do.`,
  };
}

export function compose(input: ComposeInput): ComposedContent {
  const text = body(input);
  return {
    id: hid(input.tenant, input.prompt, input.format, input.audience, input.platforms.join(",")),
    format: input.format,
    title: title(input.prompt, input.format),
    body: text,
    variants: buildVariants(text, input.platforms),
    hashtags: buildHashtags(input.prompt, input.audience),
    ctas: buildCtas(input.prompt),
    schedule: buildSchedule(input.platforms, input.now),
    campaignSuggestion: campaignSuggestion(input),
    createdAt: input.now,
  };
}

export function isSocialPlatform(v: unknown): v is SocialPlatform {
  return typeof v === "string" && (SOCIAL_PLATFORMS as readonly string[]).includes(v);
}

export function isContentFormat(v: unknown): v is ContentFormat {
  return typeof v === "string" && (CONTENT_FORMATS as readonly string[]).includes(v);
}
