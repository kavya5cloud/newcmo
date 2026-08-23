import { createHash } from "node:crypto";
import type { SocialPlatform } from "@/lib/social/types";
import { describe, expand } from "./recurrence";
import { parseAutomations } from "./parse";
import type {
  Automation, AutomationSummary, ContentSource, QueueItem, QueueState, ReleaseMode,
} from "./types";

// The automation engine.
//
// It owns exactly two things: which automations exist, and which slots they imply. It
// does not publish, retry, back off or dead-letter — the M12 Publishing Engine already
// does all of that, and a second scheduler is how a product ends up double-posting.
//
// Slot ids are content-addressed (automation + time), so expanding the same window twice
// produces the same ids. Re-running the expansion is therefore safe: existing slots are
// recognised rather than duplicated, which is the property that stops an automation from
// flooding a queue every time the page refreshes.

function slotId(automationId: string, at: number): string {
  return "q_" + createHash("sha256").update(`${automationId}|${at}`).digest("hex").slice(0, 16);
}

function automationId(tenant: string, platform: string, statement: string): string {
  return "auto_" + createHash("sha256").update(`${tenant}|${platform}|${statement}`).digest("hex").slice(0, 12);
}

export type CreateResult = {
  automations: Automation[];
  /** Clauses that could not be parsed, with the reason, so the UI can show them. */
  rejected: { text: string; reason: string }[];
};

/**
 * Build automations from a plain-language instruction.
 *
 * "Publish 3 LinkedIn posts every week, 2 X posts daily, and an Instagram carousel every
 * Friday" becomes three automations. Unparseable clauses are returned, not dropped
 * silently — a founder who typed four rules and got three must be told which one failed.
 */
export function createAutomations(
  tenant: string,
  statement: string,
  opts: { release?: ReleaseMode; now?: number } = {},
): CreateResult {
  const now = opts.now ?? Date.now();
  const release = opts.release ?? "after_approval";
  const parsed = parseAutomations(statement);

  const automations: Automation[] = [];
  const rejected: { text: string; reason: string }[] = [];

  for (const clause of parsed.clauses) {
    if (!clause.ok) { rejected.push({ text: clause.text, reason: clause.reason }); continue; }
    automations.push({
      id: automationId(tenant, clause.platform, clause.text),
      tenant,
      statement: clause.text,
      platform: clause.platform,
      cadence: clause.cadence,
      source: clause.source,
      release,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { automations, rejected };
}

export type MaterializeOptions = {
  from: number;
  /** How far ahead to fill. Two weeks by default — far enough to be useful, near enough
   *  that a paused automation doesn't leave months of stale slots behind. */
  horizonDays?: number;
  limitPerAutomation?: number;
};

/**
 * Expand active automations into queue items for the window.
 *
 * Existing items are passed in so their state is preserved: a slot already published or
 * cancelled is never regenerated as "upcoming".
 */
export function materialize(
  automations: Automation[],
  existing: QueueItem[],
  opts: MaterializeOptions,
): QueueItem[] {
  const horizon = (opts.horizonDays ?? 14) * 86_400_000;
  const to = opts.from + horizon;
  const byId = new Map(existing.map((q) => [q.id, q]));
  const out: QueueItem[] = [...existing];

  for (const a of automations) {
    if (!a.active) continue;
    const times = expand(a.cadence, { from: opts.from, to, limit: opts.limitPerAutomation ?? 60 });
    for (const at of times) {
      const id = slotId(a.id, at);
      if (byId.has(id)) continue;               // already known, in whatever state it holds
      const item: QueueItem = {
        id, tenant: a.tenant, automationId: a.id, platform: a.platform, source: a.source,
        at,
        // Release mode decides whether a slot is ready to run or held for a human.
        state: a.release === "after_approval" ? "waiting_approval" : "upcoming",
        jobId: null,
        order: 0,
        note: null,
      };
      byId.set(id, item);
      out.push(item);
    }
  }

  return out.sort((x, y) => x.at - y.at || x.order - y.order);
}

/** Reorder within the queue. Manual order only breaks ties at the same due time. */
export function reorder(queue: QueueItem[], id: string, newOrder: number): QueueItem[] {
  return queue.map((q) => (q.id === id ? { ...q, order: newOrder } : q));
}

const ALLOWED: Record<QueueState, QueueState[]> = {
  upcoming: ["publishing", "cancelled", "waiting_approval", "skipped"],
  waiting_approval: ["upcoming", "cancelled", "skipped"],
  publishing: ["published", "failed"],
  failed: ["retrying", "cancelled"],
  retrying: ["publishing", "failed", "cancelled"],
  published: [],
  cancelled: [],
  skipped: ["upcoming"],
};

/** Guarded state change. A published slot can never be moved — the post is already out. */
export function setState(queue: QueueItem[], id: string, next: QueueState, note?: string): { queue: QueueItem[]; ok: boolean; error?: string } {
  const item = queue.find((q) => q.id === id);
  if (!item) return { queue, ok: false, error: "That queue item no longer exists." };
  if (!ALLOWED[item.state].includes(next)) {
    return { queue, ok: false, error: `A ${item.state.replace(/_/g, " ")} item cannot become ${next.replace(/_/g, " ")}.` };
  }
  return {
    queue: queue.map((q) => (q.id === id
      // Stamped on the way into `publishing` and cleared on the way out, so the timestamp
      // always describes the claim currently held rather than the last one ever taken.
      ? { ...q, state: next, note: note ?? q.note, claimedAt: next === "publishing" ? Date.now() : null }
      : q)),
    ok: true,
  };
}

/** Duplicate a slot to the next free minute, so it doesn't collide with its original. */
export function duplicate(queue: QueueItem[], id: string): QueueItem[] {
  const item = queue.find((q) => q.id === id);
  if (!item) return queue;
  const at = item.at + 60_000;
  const copy: QueueItem = { ...item, id: slotId(item.automationId, at), at, state: "upcoming", jobId: null, note: "Duplicated" };
  return [...queue, copy].sort((x, y) => x.at - y.at || x.order - y.order);
}

export function summarize(automations: Automation[], queue: QueueItem[]): AutomationSummary[] {
  return automations.map((a) => {
    const items = queue.filter((q) => q.automationId === a.id);
    const upcoming = items.filter((q) => q.state === "upcoming" || q.state === "waiting_approval");
    return {
      automationId: a.id,
      statement: a.statement,
      platform: a.platform,
      active: a.active,
      cadenceLabel: describe(a.cadence),
      upcoming: upcoming.length,
      published: items.filter((q) => q.state === "published").length,
      failed: items.filter((q) => q.state === "failed").length,
      nextAt: upcoming.length ? Math.min(...upcoming.map((q) => q.at)) : null,
    };
  });
}

/** Slots due now, in order, ready to hand to the Publishing Engine. */
export function due(queue: QueueItem[], now: number): QueueItem[] {
  return queue
    .filter((q) => q.state === "upcoming" && q.at <= now)
    .sort((a, b) => a.at - b.at || a.order - b.order);
}

export type { Automation, QueueItem, QueueState, ContentSource, SocialPlatform };
