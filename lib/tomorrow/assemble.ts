import { automationRepo } from "@/lib/automation/shared";
import { angleKeyFor, formKeyFor, ANGLES, FORMS } from "@/lib/automation/topic";
import { assistantStore } from "@/lib/assistant/shared";
import { refusalRepo } from "@/lib/refusals/store";
import { REASON_LABEL } from "@/lib/refusals/types";
import type { QueueItem } from "@/lib/automation/types";
import type { SocialPlatform } from "@/lib/social/types";

// Tomorrow — the one thing a founder should have to read.
//
// The product accumulated four surfaces that each ask for a decision: a dashboard of
// columns, a launch workspace with a command bar, an agent board with per-agent pause and
// approve, and a publishing queue. All real, all useful to an operator, and collectively a
// control panel — which is the opposite of what this product sells. Nobody buys a CMO in
// order to run one.
//
// So this assembles the single review that replaces them: what the agents have already
// decided to do tomorrow, what they decided not to do, and whether anything genuinely needs
// a human. The decisions are made. This is the founder reading them.
//
// Deliberately assembles rather than decides. Every judgement here was already made
// somewhere with its own reasons — the angle rotation, the planner's scoring, the refusal
// ledger — and re-deciding any of it in a view layer would give two answers to one
// question.

const DAY = 86_400_000;

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn", x: "X", instagram_business: "Instagram",
  facebook_pages: "Facebook", threads: "Threads", pinterest: "Pinterest",
};

export type PlannedPost = {
  id: string;
  at: number;
  platform: string;
  platformLabel: string;
  /** What it will be about, in the words the brief uses. */
  angle: string;
  /** How it will be built. */
  form: string;
  /** True when this slot cannot go out without someone saying yes. */
  needsApproval: boolean;
  /** Whether the platform can actually publish. A slot for a platform that cannot is a lie. */
  willActuallyPublish: boolean;
};

export type SkippedWork = {
  proposed: string;
  channel: string;
  reason: string;
  explanation: string;
};

export type Tomorrow = {
  /** Midnight-to-midnight window this describes, in epoch ms. */
  from: number;
  to: number;
  posts: PlannedPost[];
  skipped: SkippedWork[];
  /** Nothing is planned and nothing was skipped — a real state with a real cause. */
  idleReason: "not_configured" | "paused" | "nothing_due" | null;
  /** How many posts cannot go out until a human says yes. */
  awaiting: number;
};

/** The window "tomorrow" means, from a given instant, in the caller's timezone offset. */
export function tomorrowWindow(now: number, tzOffsetMinutes = 0): { from: number; to: number } {
  // Work in the viewer's local day rather than UTC. A founder in Bengaluru asking at 01:00
  // means the next calendar day where they are, not the one that started in Greenwich.
  //
  // Local time is UTC *plus* the offset, so shifting forward is what puts the epoch on the
  // viewer's calendar; the result is shifted back to get a real instant. The signs were the
  // other way round first and every IST user would have been shown the wrong day — off by
  // one only between 18:30 and 24:00 UTC, which is exactly when a founder in India reviews
  // tomorrow.
  const shifted = now + tzOffsetMinutes * 60_000;
  const startOfLocalToday = Math.floor(shifted / DAY) * DAY;
  const from = startOfLocalToday + DAY - tzOffsetMinutes * 60_000;
  return { from, to: from + DAY };
}

const label = (list: readonly { key: string; ask: string }[], key: string): string =>
  list.find((a) => a.key === key)?.ask ?? key;

export type AssembleTomorrowDeps = {
  /** Platforms that can genuinely publish right now. */
  livePlatforms: Set<string>;
};

export async function assembleTomorrow(
  tenant: string,
  now: number,
  deps: AssembleTomorrowDeps,
  tzOffsetMinutes = 0,
): Promise<Tomorrow> {
  const { from, to } = tomorrowWindow(now, tzOffsetMinutes);

  const [queue, settings, refusals] = await Promise.all([
    automationRepo().listQueue(tenant).catch(() => [] as QueueItem[]),
    assistantStore().get(tenant).catch(() => null),
    refusalRepo().list(tenant, 40).catch(() => []),
  ]);

  const due = queue
    .filter((q) => q.at >= from && q.at < to)
    .filter((q) => q.state === "upcoming" || q.state === "waiting_approval")
    .sort((a, b) => a.at - b.at);

  const posts: PlannedPost[] = due.map((q) => ({
    id: q.id,
    at: q.at,
    platform: q.platform,
    platformLabel: PLATFORM_LABEL[q.platform] ?? q.platform,
    angle: label(ANGLES, angleKeyFor(q, settings?.goal)),
    form: label(FORMS, formKeyFor(q)),
    needsApproval: q.state === "waiting_approval",
    willActuallyPublish: deps.livePlatforms.has(q.platform),
  }));

  // Only refusals from the last day. A ledger going back months is a research artefact;
  // what belongs on tomorrow's page is what was declined while deciding tomorrow.
  const recent = refusals.filter((r) => r.createdAt >= now - DAY);
  const skipped: SkippedWork[] = recent.slice(0, 6).map((r) => ({
    proposed: r.proposed,
    channel: r.channel,
    reason: REASON_LABEL[r.reason],
    explanation: r.explanation,
  }));

  // An empty page has to say which empty it is. "Nothing planned" reads as broken when the
  // real answer is "you never set this up" or "you paused it".
  let idleReason: Tomorrow["idleReason"] = null;
  if (posts.length === 0) {
    if (!settings) idleReason = "not_configured";
    else if (settings.paused) idleReason = "paused";
    else idleReason = "nothing_due";
  }

  return {
    from, to, posts, skipped, idleReason,
    awaiting: posts.filter((p) => p.needsApproval).length,
  };
}

/** One sentence for the top of the page. Built from counts, never from a model. */
export function tomorrowHeadline(t: Tomorrow): string {
  if (t.posts.length === 0) {
    switch (t.idleReason) {
      case "not_configured": return "Nothing is planned yet.";
      case "paused": return "Your marketing is paused.";
      default: return "Nothing is scheduled for tomorrow.";
    }
  }
  const where = [...new Set(t.posts.map((p) => p.platformLabel))];
  const n = t.posts.length;
  return `${n} post${n === 1 ? "" : "s"} going out on ${
    where.length === 1 ? where[0] : `${where.slice(0, -1).join(", ")} and ${where[where.length - 1]}`
  }.`;
}

export type { SocialPlatform };
