import type { QueueItem } from "./types";
import type { Goal } from "@/lib/assistant/types";
import type { SocialPlatform } from "@/lib/social/types";

// What to write about on a given day.
//
// This used to strip numbers and cadence words out of the automation's own statement, which
// turned "3 LinkedIn posts every week" into the prompt "LinkedIn   week" — and asked for
// exactly that, every day, forever. Same tenant, same prompt, same format: identical posts.
//
// A cadence says how often to post. It has never said what to say. Those are different
// questions and this file answers the second one.
//
// Two rules:
//   - Every calendar day gets a different angle, so a week does not read as one post sent
//     seven times.
//   - The same day always gets the same angle. Re-running a day must not produce a second,
//     different post — the slot is already idempotent and the prompt has to match.

/**
 * Angles, not topics. Each is a different way into the same business, so the writer keeps
 * saying something new without needing new facts every morning.
 */
export const ANGLES = [
  { key: "shipped", ask: "something you improved recently and who it helps" },
  { key: "problem", ask: "a specific problem your audience runs into, and how to think about it" },
  { key: "lesson", ask: "a lesson learned the hard way, told plainly and without a moral" },
  { key: "myth", ask: "a common belief in your space that is wrong, and what is true instead" },
  { key: "howto", ask: "one practical thing a reader could do this week" },
  { key: "behind", ask: "an honest behind-the-scenes note about how the work actually goes" },
  { key: "result", ask: "a concrete result and what produced it" },
] as const;

export type Angle = (typeof ANGLES)[number];

/**
 * How today's post is built, as opposed to what it is about.
 *
 * Seven angles on a seven-day week means the second Monday asks for exactly what the first
 * Monday asked for. Angle alone was never going to carry a month. Pairing it with a form
 * that turns on a different cycle takes the repeat from every 7 days to every 42, because
 * 7 and 6 share no factor — and a reader notices a shape sooner than a subject anyway.
 *
 * These are shapes, not templates. The composer already owns the writing; this only says
 * what the post should look like when it lands.
 */
export const FORMS = [
  { key: "story", ask: "Tell it as one short story with a beginning and an end." },
  { key: "list", ask: "Build it around three short dashed points." },
  { key: "contrast", ask: "Set two things against each other — what people do, and what works." },
  { key: "question", ask: "Open on a real question and spend the post answering it." },
  { key: "note", ask: "Write it as a short direct note, no framing and no wind-up." },
  { key: "number", ask: "Anchor it on one concrete number or detail and build outward." },
] as const;

export type Form = (typeof FORMS)[number];

/** The form for one slot. Same staggering as the angle, on its own cycle. */
export function formFor(at: number, platform: SocialPlatform): Form {
  let shift = 0;
  for (let i = 0; i < platform.length; i++) shift = (shift + platform.charCodeAt(i)) % FORMS.length;
  return FORMS[(dayIndex(at) + shift) % FORMS.length];
}

/** Which angles a goal leans on. The goal shifts emphasis; it does not narrow to one note. */
const GOAL_ANGLES: Record<Goal, readonly string[]> = {
  customers: ["problem", "result", "myth", "howto"],
  traffic: ["howto", "problem", "myth", "lesson"],
  brand: ["lesson", "behind", "myth", "shipped"],
  launch: ["shipped", "result", "behind", "howto"],
  active: ANGLES.map((a) => a.key),
};

/** Whole days since the epoch — the calendar day a slot falls on, in UTC. */
export function dayIndex(at: number): number {
  return Math.floor(at / 86_400_000);
}

/**
 * The angle for one slot.
 *
 * Keyed on the calendar day so it is stable for that day and different from the next. The
 * platform shifts the offset too, so two platforms posting the same morning do not say the
 * same thing in two places — which reads worse than posting nothing.
 */
export function angleFor(at: number, platform: SocialPlatform, goal: Goal = "active"): Angle {
  const allowed = GOAL_ANGLES[goal] ?? GOAL_ANGLES.active;
  const pool = ANGLES.filter((a) => allowed.includes(a.key));
  const list = pool.length ? pool : ANGLES;

  // A stable per-platform offset, so the rotation is staggered rather than duplicated.
  let shift = 0;
  for (let i = 0; i < platform.length; i++) shift = (shift + platform.charCodeAt(i)) % list.length;

  return list[(dayIndex(at) + shift) % list.length];
}

export type TopicContext = {
  /** What the business is, e.g. "Acme". */
  product?: string;
  /** One line on what it does. */
  oneLiner?: string;
  audience?: string;
  goal?: Goal;
  /** Openings already used recently, so today does not repeat one. */
  recent?: string[];
};

/**
 * The prompt for one slot: what the business is, who it is for, and today's angle.
 *
 * Deliberately a brief rather than a template. The composer already knows the brand voice
 * and the platform's limits; what it lacked was anything that changed from one day to the
 * next.
 */
export function topicForSlot(slot: QueueItem, ctx: TopicContext = {}): string {
  const angle = angleFor(slot.at, slot.platform as SocialPlatform, ctx.goal ?? "active");
  const form = formFor(slot.at, slot.platform as SocialPlatform);
  const product = (ctx.product || "").trim();
  const audience = (ctx.audience || "").trim() || "the people you sell to";
  const oneLiner = (ctx.oneLiner || "").trim();

  const parts: string[] = [];
  parts.push(`Write ${angle.ask}.`);
  // What it is about, then how it is built. Both turn over daily, on cycles that do not
  // line up, so the same pairing does not come round for six weeks.
  parts.push(form.ask);

  if (product) {
    parts.push(oneLiner
      ? `You are ${product} — ${oneLiner}.`
      : `You are ${product}.`);
  }
  parts.push(`Write it for ${audience}.`);

  // Naming what to avoid is more reliable than asking for novelty in the abstract.
  if (ctx.recent?.length) {
    const openings = ctx.recent
      .map((t) => t.split(/\s+/).slice(0, 6).join(" ").trim())
      .filter(Boolean)
      .slice(0, 5);
    if (openings.length) {
      parts.push(`Do not open the way any of these did: ${openings.map((o) => `"${o}"`).join("; ")}.`);
    }
  }

  return parts.join(" ");
}

/**
 * The angle key for a slot, for logging and for the "why this post" trail. Kept separate so
 * callers can record it without re-deriving the whole prompt.
 */
export function angleKeyFor(slot: QueueItem, goal: Goal = "active"): string {
  return angleFor(slot.at, slot.platform as SocialPlatform, goal).key;
}

/** The form key, logged beside the angle. "lesson/list" is the pair that must not recur. */
export function formKeyFor(slot: QueueItem): string {
  return formFor(slot.at, slot.platform as SocialPlatform).key;
}
