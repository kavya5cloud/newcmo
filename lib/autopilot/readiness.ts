import type { AssistantSettings } from "@/lib/assistant/types";
import type { Automation } from "@/lib/automation/types";
import { isStale, type Heartbeat } from "./heartbeat";

// What is standing between Populr and posting by itself.
//
// The honest answer to "why hasn't it posted" was, until now, three curl commands and a
// workflow file: are the app credentials set, is an account connected, is the schedule
// running, does this workspace hold posts for approval. All knowable, none visible.
//
// Every check here is deterministic and reads state that already exists. Nothing asks a
// model, and nothing is inferred — a blocker is reported because a specific value is a
// specific way, and each one names the single next action rather than a category of
// problem. "Not configured" is a support ticket; "connect LinkedIn" is a click.

export type BlockerCode =
  | "no_plan"
  | "not_configured"
  | "paused"
  | "no_live_platform"
  | "no_account"
  | "holds_for_approval"
  | "publisher_stalled";

export type Blocker = {
  code: BlockerCode;
  title: string;
  detail: string;
  /** Where to go and fix it. Absent when the fix is not something a user can click. */
  fix: { label: string; href: string } | null;
  /**
   * True when this stops posting outright. False when posting still happens but not
   * unattended — holding for approval is a choice, not a fault, and reporting it as a
   * failure would tell someone their working setup is broken.
   */
  blocking: boolean;
};

export type Readiness = {
  /** Populr will publish without anyone doing anything. */
  autonomous: boolean;
  blockers: Blocker[];
  /** Steps already satisfied, so progress is visible rather than only what is missing. */
  done: string[];
};

export type ReadinessInput = {
  /** Trial or subscription. Publishing is part of the plan. */
  hasPlan: boolean;
  settings: AssistantSettings | null;
  automations: Automation[];
  /** Platforms with a connected, healthy account in this workspace. */
  connectedPlatforms: string[];
  /** Platforms whose adapter can genuinely reach the provider. */
  livePlatforms: string[];
  heartbeat: Heartbeat | null;
  now: number;
};

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn", x: "X", instagram_business: "Instagram",
  facebook_pages: "Facebook", threads: "Threads", pinterest: "Pinterest",
};
const label = (p: string) => PLATFORM_LABEL[p] ?? p;

export function assessAutopilot(input: ReadinessInput): Readiness {
  const blockers: Blocker[] = [];
  const done: string[] = [];

  if (!input.hasPlan) {
    blockers.push({
      code: "no_plan", blocking: true,
      title: "Your plan has ended",
      detail: "Publishing and scheduling are part of the plan. Nothing goes out until it is active.",
      fix: { label: "Subscribe", href: "/api/billing/checkout" },
    });
  } else {
    done.push("Plan active");
  }

  if (!input.settings) {
    blockers.push({
      code: "not_configured", blocking: true,
      title: "Populr has not been told what to work on",
      detail: "Four questions — what to post, where, how often, and how much you want to review.",
      fix: { label: "Set it up", href: "/app" },
    });
    // Everything below depends on a configuration that does not exist, and listing six
    // blockers for one missing setup reads as a broken product rather than an unfinished one.
    return { autonomous: false, blockers, done };
  }
  done.push("Marketing configured");

  if (input.settings.paused) {
    blockers.push({
      code: "paused", blocking: true,
      title: "Your marketing is paused",
      detail: "Nothing is planned or published while it is paused. Existing history is kept.",
      fix: { label: "Resume", href: "/studio/social" },
    });
  }

  // A platform that can publish, and an account on it. These fail differently and the fix
  // is different: one is our credentials missing, the other is the user's consent missing.
  const publishable = input.connectedPlatforms.filter((p) => input.livePlatforms.includes(p));
  if (input.livePlatforms.length === 0) {
    blockers.push({
      code: "no_live_platform", blocking: true,
      title: "No platform can publish yet",
      detail: "Populr's own app credentials are not set for any platform, so posts are written and never sent.",
      // Not a user fix. Saying "connect an account" here would send someone to a button
      // that cannot work, and they would blame themselves for our missing configuration.
      fix: null,
    });
  } else if (publishable.length === 0) {
    blockers.push({
      code: "no_account", blocking: true,
      title: "No account connected",
      detail: `Populr can publish to ${input.livePlatforms.map(label).join(" and ")}. It needs your permission once.`,
      fix: { label: "Connect an account", href: "/studio/integrations" },
    });
  } else {
    done.push(`Connected: ${publishable.map(label).join(", ")}`);
  }

  // Holding for approval is a preference, not a failure. It is reported so the answer to
  // "why did nothing go out overnight" is on the screen, but it never marks the setup broken.
  const holding = input.automations.filter((a) => a.active && a.release === "after_approval");
  if (holding.length > 0) {
    blockers.push({
      code: "holds_for_approval", blocking: false,
      title: "Posts wait for you",
      detail: "You chose to review before anything goes out, so nothing publishes unattended. That is a setting, not a fault.",
      fix: { label: "Let Populr handle routine posts", href: "/app" },
    });
  } else if (input.automations.some((a) => a.active)) {
    done.push("Publishes without approval");
  }

  if (isStale(input.heartbeat, input.now)) {
    blockers.push({
      code: "publisher_stalled", blocking: true,
      title: input.heartbeat ? "The publisher has gone quiet" : "The publisher has never run",
      detail: input.heartbeat
        ? "Nothing has published in over half an hour. Due posts are queued, not lost."
        : "No publishing pass has ever completed, so scheduled posts are sitting in the queue.",
      fix: null,
    });
  } else {
    done.push("Publisher running");
  }

  return {
    autonomous: blockers.every((b) => !b.blocking) && blockers.every((b) => b.code !== "holds_for_approval"),
    blockers,
    done,
  };
}
