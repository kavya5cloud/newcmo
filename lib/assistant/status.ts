import type { QueueItem } from "@/lib/automation/types";
import type { AssistantStatus } from "./types";
import { earlyAccessAmong } from "./plan";
import type { SocialPlatform } from "@/lib/social/types";

// The one screen's worth of facts.
//
// Deliberately four numbers and nothing else. Every extra number on a status screen is
// another thing the reader has to decide whether to care about, and the whole point is that
// they should not have to care — they should see that it is handled, and the one thing
// waiting on them.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build the status from real queue items.
 *
 * Pure and clock-injectable so "this week" means something testable rather than whatever
 * today happens to be.
 */
export function buildStatus(
  queue: QueueItem[],
  opts: { configured: boolean; paused: boolean; platforms: SocialPlatform[]; now?: number },
): AssistantStatus {
  const now = opts.now ?? Date.now();
  const horizon = now + WEEK_MS;

  // Only what is genuinely still going to happen. A published or cancelled slot is history,
  // and counting it as "planned" would inflate the number every week.
  const upcoming = queue
    .filter((q) => q.state === "upcoming" || q.state === "waiting_approval")
    .filter((q) => q.at >= now)
    .sort((a, b) => a.at - b.at);

  const next = upcoming[0] ?? null;

  return {
    configured: opts.configured,
    paused: opts.paused,
    plannedThisWeek: upcoming.filter((q) => q.at <= horizon).length,
    nextPublishAt: next?.at ?? null,
    nextPublishPlatform: next?.platform ?? null,
    // Approvals are counted across the whole queue, not just this week: something waiting on
    // the user from ten days out is still waiting on the user.
    awaitingApproval: queue.filter((q) => q.state === "waiting_approval").length,
    earlyAccessPlatforms: earlyAccessAmong(opts.platforms),
  };
}

/**
 * "Tomorrow 9:00 AM" rather than a date stamp.
 *
 * People read a status line to know whether they need to do anything today, and a raw date
 * makes them work that out themselves.
 */
export function describeWhen(at: number, now = Date.now(), timeZone?: string): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });

  const dayKey = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone });
  const today = dayKey(now);
  const tomorrow = dayKey(now + 24 * 60 * 60 * 1000);
  const target = dayKey(at);

  if (target === today) return `Today ${time}`;
  if (target === tomorrow) return `Tomorrow ${time}`;

  // Inside a week, the weekday is more useful than the date.
  if (at - now < 7 * 24 * 60 * 60 * 1000) {
    return `${d.toLocaleDateString("en-US", { weekday: "long", timeZone })} ${time}`;
  }
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone })} ${time}`;
}

/** The single line at the top: what state is my marketing in? */
export function headline(status: AssistantStatus): string {
  if (!status.configured) return "Not set up yet";
  if (status.paused) return "Paused";
  return "Working";
}
