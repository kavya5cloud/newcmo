import type { SocialPlatform } from "@/lib/social/types";

// The Marketing Assistant — the whole product surface for "keep my marketing running".
//
// Four questions, and nothing else asked. Everything the engine underneath needs — release
// modes, content sources, recurrence — is derived from the answers in plan.ts. None of those
// words appear in this file's labels, and none of them should ever reach a screen.
//
// The vocabulary rule is deliberate: a business owner is buying "my marketing is handled",
// not a tool they have to learn. If a label here starts sounding like software, it is wrong.

// ---------------------------------------------------------------- 1. How often

export const CADENCES = ["daily", "few_weekly", "weekly"] as const;
export type AssistantCadence = (typeof CADENCES)[number];

export const CADENCE_META: Record<AssistantCadence, { label: string; detail: string; perWeek: number }> = {
  daily: { label: "Every day", detail: "Best for building an audience fast", perWeek: 5 },
  few_weekly: { label: "A few times a week", detail: "Steady presence without the grind", perWeek: 3 },
  weekly: { label: "Once a week", detail: "Light touch, still consistent", perWeek: 1 },
};

// ---------------------------------------------------------------- 2. Which platforms

/**
 * Readiness is about the product, not your configuration.
 *
 * Every platform Populr is heading towards is listed. Hiding the ones that cannot publish
 * yet would teach people "Populr doesn't do Instagram", which is a worse and much stickier
 * belief than "not yet". Choosing one still does something real — Populr writes for it —
 * so the label says exactly where the line is.
 */
export type Readiness = "ready" | "early_access";

export const PLATFORM_CHOICES: {
  platform: SocialPlatform;
  label: string;
  readiness: Readiness;
  /** What actually happens if this is picked. Shown when it is selected. */
  expectation: string;
}[] = [
  {
    platform: "linkedin", label: "LinkedIn", readiness: "ready",
    expectation: "Populr writes and publishes for you.",
  },
  {
    platform: "x", label: "X", readiness: "ready",
    expectation: "Populr writes and publishes for you.",
  },
  {
    platform: "instagram_business", label: "Instagram", readiness: "early_access",
    expectation: "Populr writes your posts now. Publishing straight to Instagram is coming — you'll be told the day it opens.",
  },
  {
    platform: "facebook_pages", label: "Facebook", readiness: "early_access",
    expectation: "Populr writes your posts now. Publishing straight to Facebook is coming — you'll be told the day it opens.",
  },
  {
    platform: "threads", label: "Threads", readiness: "early_access",
    expectation: "Populr writes your posts now. Publishing straight to Threads is coming — you'll be told the day it opens.",
  },
  {
    platform: "pinterest", label: "Pinterest", readiness: "early_access",
    expectation: "Populr writes your pins now. Publishing straight to Pinterest is coming — you'll be told the day it opens.",
  },
];

export const READY_PLATFORMS = PLATFORM_CHOICES.filter((p) => p.readiness === "ready").map((p) => p.platform);

// ---------------------------------------------------------------- 3. How much control

export const CONTROL_LEVELS = ["review_all", "review_important", "handle_routine"] as const;
export type ControlLevel = (typeof CONTROL_LEVELS)[number];

export const CONTROL_META: Record<ControlLevel, { label: string; detail: string }> = {
  review_all: { label: "Review everything", detail: "Nothing goes out until you say so" },
  review_important: { label: "Review important posts only", detail: "Launches and anything with your face on it" },
  handle_routine: { label: "Let Populr handle routine marketing", detail: "You'll still see everything afterwards" },
};

// ---------------------------------------------------------------- 4. What's your goal

export const GOALS = ["customers", "traffic", "brand", "launch", "active"] as const;
export type Goal = (typeof GOALS)[number];

export const GOAL_META: Record<Goal, { label: string; detail: string }> = {
  customers: { label: "More customers", detail: "Posts that make people want what you sell" },
  traffic: { label: "Website traffic", detail: "Posts that send people to your site" },
  brand: { label: "Personal brand", detail: "Your point of view, in your voice" },
  launch: { label: "Product launch", detail: "Build up to a date and land it" },
  active: { label: "Stay active", detail: "Never go quiet, without thinking about it" },
};

// ---------------------------------------------------------------- The four answers

export type AssistantSetup = {
  cadence: AssistantCadence;
  platforms: SocialPlatform[];
  control: ControlLevel;
  goal: Goal;
};

export type AssistantSettings = AssistantSetup & {
  tenant: string;
  /** Paused means nothing new is planned or published; existing plans keep their history. */
  paused: boolean;
  createdAt: number;
  updatedAt: number;
};

/**
 * What the one status screen shows. Every field is a plain fact about the user's marketing —
 * there is nothing here describing how the system works.
 */
export type AssistantStatus = {
  configured: boolean;
  paused: boolean;
  /** Posts planned for the next seven days. */
  plannedThisWeek: number;
  /** When the next one goes out, or null if nothing is scheduled. */
  nextPublishAt: number | null;
  nextPublishPlatform: SocialPlatform | null;
  /** How many pieces are waiting on the user. This is the only thing they must act on. */
  awaitingApproval: number;
  /** Platforms chosen that cannot publish yet, so the screen can be honest about it. */
  earlyAccessPlatforms: SocialPlatform[];
};

// ---------------------------------------------------------------- Advanced

/**
 * Everything a business owner should never be asked. These have working defaults derived
 * from the four answers; the panel exists so the answer to "can I change X?" is yes.
 */
export type AdvancedSettings = {
  /** Upper bound per platform per week, so a goal change can never spam an audience. */
  maxPostsPerWeek: number;
  /** Approval reminders after this many hours. */
  approvalReminderHours: number;
  /** Words Populr will never publish. */
  blockedTerms: string[];
  /** Platforms explicitly turned off without changing the goal. */
  mutedPlatforms: SocialPlatform[];
};

export const ADVANCED_DEFAULTS: AdvancedSettings = {
  maxPostsPerWeek: 7,
  approvalReminderHours: 24,
  blockedTerms: [],
  mutedPlatforms: [],
};
