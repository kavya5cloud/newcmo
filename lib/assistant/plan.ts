import type { SocialPlatform } from "@/lib/social/types";
import type { ContentSource, ReleaseMode } from "@/lib/automation/types";
import {
  CADENCE_META, PLATFORM_CHOICES, READY_PLATFORMS,
  type AssistantSetup, type ControlLevel, type Goal,
} from "./types";

// Turns four answers into something the existing publishing engine already understands.
//
// This is a translation, not a new engine. Populr already knows how to keep a cadence, hold
// a post for approval and retry a failed publish; it just needed those things described in
// a sentence. So the four answers become the same sentence a user could have typed, and
// lib/automation parses it exactly as before. Nothing here schedules or publishes.

/** Platform names the parser recognises, which are not always the internal ids. */
const PLATFORM_WORD: Record<SocialPlatform, string> = {
  linkedin: "LinkedIn",
  x: "X",
  instagram_business: "Instagram",
  facebook_pages: "Facebook",
  threads: "Threads",
  pinterest: "Pinterest",
};

/**
 * Where posts come from, chosen by the goal.
 *
 * A launch has a campaign behind it; everything else is Populr writing fresh each time.
 * The user is never asked this — the goal answers it, which is the point.
 */
export function sourceForGoal(goal: Goal): ContentSource {
  return goal === "launch" ? "campaigns" : "ai_queue";
}

/**
 * How much gets held for approval.
 *
 * "Review important only" is the one that needs care: it cannot mean "guess what matters".
 * It means launch content waits — that is the content with a date attached and the most to
 * lose — while routine posts go at the best time. Anything else would be a coin flip
 * dressed up as a preference.
 */
export function releaseFor(control: ControlLevel, source: ContentSource): ReleaseMode {
  if (control === "review_all") return "after_approval";
  if (control === "handle_routine") return "best_time";
  return source === "campaigns" ? "after_approval" : "best_time";
}

/** Posts per week per platform, from the cadence answer. */
export function postsPerWeek(setup: AssistantSetup): number {
  return CADENCE_META[setup.cadence].perWeek;
}

/**
 * The sentence Populr would have asked the user to write.
 *
 * Kept human on purpose: it is stored verbatim on each automation and is what shows up if
 * anyone ever needs to see why a post went out. "3 LinkedIn posts every week" explains
 * itself; a serialised config object does not.
 */
export function statementFor(setup: AssistantSetup, platform: SocialPlatform): string {
  const n = postsPerWeek(setup);
  const name = PLATFORM_WORD[platform];
  if (setup.cadence === "daily") return `1 ${name} post every day`;
  return `${n} ${name} post${n === 1 ? "" : "s"} every week`;
}

export type PlannedPlatform = {
  platform: SocialPlatform;
  statement: string;
  release: ReleaseMode;
  source: ContentSource;
  /** False when Populr will write for this platform but cannot publish to it yet. */
  canPublish: boolean;
};

/**
 * The full plan implied by four answers.
 *
 * Early-access platforms are included rather than filtered out. Populr genuinely writes for
 * them, and the content is real and usable — it is only the last step, handing the post to
 * the platform, that does not exist yet. Dropping them here would quietly turn a chosen
 * platform into nothing at all, which is exactly the outcome the readiness label exists to
 * prevent.
 */
export function planFor(setup: AssistantSetup): PlannedPlatform[] {
  const source = sourceForGoal(setup.goal);
  const release = releaseFor(setup.control, source);
  return setup.platforms.map((platform) => ({
    platform,
    statement: statementFor(setup, platform),
    release,
    source,
    canPublish: (READY_PLATFORMS as SocialPlatform[]).includes(platform),
  }));
}

/** Chosen platforms that cannot publish yet — the status screen says so plainly. */
export function earlyAccessAmong(platforms: SocialPlatform[]): SocialPlatform[] {
  const early = new Set(
    PLATFORM_CHOICES.filter((p) => p.readiness === "early_access").map((p) => p.platform),
  );
  return platforms.filter((p) => early.has(p));
}

/**
 * A setup Populr can start from without asking anything.
 *
 * Used when a question can be skipped — the fewer questions asked, the better, so long as
 * the guess is one a reasonable person would have made anyway.
 */
export function defaultSetup(connected: SocialPlatform[] = []): AssistantSetup {
  const ready = connected.filter((p) => (READY_PLATFORMS as SocialPlatform[]).includes(p));
  return {
    cadence: "few_weekly",
    platforms: ready.length ? ready : ["linkedin"],
    control: "review_all",   // start cautious; trust is earned before it is assumed
    goal: "customers",
  };
}

/** Human summary of the plan, for the confirmation line. No system words. */
export function describePlan(setup: AssistantSetup): string {
  const n = postsPerWeek(setup);
  const count = setup.platforms.length;
  const where = count === 1
    ? PLATFORM_WORD[setup.platforms[0]]
    : `${count} platforms`;
  const per = setup.cadence === "daily" ? "every day" : `${n}× a week`;
  return `${where}, ${per}.`;
}
