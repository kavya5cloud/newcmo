import { createHash } from "node:crypto";
import { PUBLISH_CHANNELS, formatWindowLabel, type PublishChannel } from "@/lib/publish-times";
import type { CampaignHealth, Notification, NotificationKind } from "./types";

// NotificationService — the things worth interrupting a founder for.
//
// Notifications are *derived*, not emitted ad hoc: the same inputs always produce the same
// set, with stable ids, so polling doesn't duplicate them and a dismissal sticks. Each one
// carries an `action` that the existing command bar can already execute — no notification
// promises something the product can't do.

export type NotificationInputs = {
  tenant: string;
  launchId: string;
  now: number;
  healths: CampaignHealth[];
  /** Platform ids with a connected account, for best-time suggestions. */
  connectedPlatforms: string[];
  failedPublishes: number;
  awaitingApprovals: number;
  /** Competitor headlines observed by Market Intelligence. */
  competitorMoves: string[];
  /** Plan progress, for ahead/behind schedule. */
  itemsDone: number;
  itemsTotal: number;
  expectedDonePercent: number;
};

function id(tenant: string, launchId: string, kind: NotificationKind, key: string): string {
  return "ntf_" + createHash("sha256").update(`${tenant}|${launchId}|${kind}|${key}`).digest("hex").slice(0, 16);
}

export class NotificationService {
  /** Derive the current notification set. Stable ids; callers merge dismissals over this. */
  derive(input: NotificationInputs): Notification[] {
    const out: Notification[] = [];
    const base = { tenant: input.tenant, launchId: input.launchId, at: input.now, dismissedAt: null };

    if (input.awaitingApprovals > 0) {
      out.push({
        ...base, id: id(input.tenant, input.launchId, "approval_required", String(input.awaitingApprovals)),
        campaignId: null, kind: "approval_required", severity: "warn",
        title: "Approval required",
        body: `${input.awaitingApprovals} step${input.awaitingApprovals === 1 ? " is" : "s are"} waiting on you before the run can continue.`,
        action: null, detail: ["Nothing publishes while a step is held."],
      });
    }

    if (input.failedPublishes > 0) {
      out.push({
        ...base, id: id(input.tenant, input.launchId, "publishing_failed", String(input.failedPublishes)),
        campaignId: null, kind: "publishing_failed", severity: "critical",
        title: "Publishing failed",
        body: `${input.failedPublishes} publish${input.failedPublishes === 1 ? "" : "es"} failed and ${input.failedPublishes === 1 ? "is" : "are"} waiting for a retry.`,
        action: "publish now", detail: ["Retries keep the adapter's backoff — retrying immediately is safe."],
      });
    }

    for (const h of input.healths) {
      const blocked = h.reasons.find((r) => r.code === "disconnected_account");
      if (blocked) {
        out.push({
          ...base, id: id(input.tenant, input.launchId, "account_disconnected", h.campaignId),
          campaignId: h.campaignId, kind: "account_disconnected", severity: "critical",
          title: "A platform account is disconnected",
          body: blocked.message, action: null, detail: [blocked.fix],
        });
      }
      const late = h.reasons.find((r) => r.code === "missed_schedule");
      if (late) {
        out.push({
          ...base, id: id(input.tenant, input.launchId, "reschedule_suggestion", h.campaignId),
          campaignId: h.campaignId, kind: "reschedule_suggestion", severity: "warn",
          title: "Schedule has slipped",
          body: late.message, action: "schedule everything", detail: [late.fix],
        });
      }
      const weak = h.reasons.find((r) => r.code === "low_engagement");
      if (weak) {
        out.push({
          ...base, id: id(input.tenant, input.launchId, "predicted_underperformance", h.campaignId),
          campaignId: h.campaignId, kind: "predicted_underperformance", severity: "warn",
          title: "Upcoming posts are predicted to underperform",
          body: weak.message, action: null, detail: [weak.fix],
        });
      }
    }

    for (const move of input.competitorMoves.slice(0, 2)) {
      out.push({
        ...base, id: id(input.tenant, input.launchId, "competitor_launch", move),
        campaignId: null, kind: "competitor_launch", severity: "info",
        title: "Competitor activity",
        body: move, action: "research market",
        detail: ["Adaptive suggestions may propose a response campaign — nothing changes without your approval."],
      });
    }

    // Best-time nudges reuse the existing publish-window model rather than inventing one.
    // Platforms that model doesn't cover get no nudge — better silent than made up.
    // Two accounts on the same platform are one audience, not two nudges.
    const modelled = [...new Set(input.connectedPlatforms)].filter((p): p is PublishChannel =>
      (PUBLISH_CHANNELS as readonly string[]).includes(p));
    for (const platform of modelled.slice(0, 2)) {
      out.push({
        ...base, id: id(input.tenant, input.launchId, "best_time", platform),
        campaignId: null, kind: "best_time", severity: "info",
        title: `${platform} audience is most active soon`,
        body: `Best observed window — ${formatWindowLabel(platform)}.`,
        action: "schedule everything",
        detail: ["Best-time optimisation moves scheduled posts into this window when it is on."],
      });
    }

    if (input.itemsTotal > 0) {
      const actual = input.itemsDone / input.itemsTotal;
      if (actual >= input.expectedDonePercent + 0.15) {
        out.push({
          ...base, id: id(input.tenant, input.launchId, "ahead_of_schedule", String(Math.round(actual * 100))),
          campaignId: null, kind: "ahead_of_schedule", severity: "info",
          title: "Campaign is ahead of schedule",
          body: `${Math.round(actual * 100)}% of items are done against ${Math.round(input.expectedDonePercent * 100)}% expected.`,
          action: null, detail: ["Consider accelerating the launch, or bank the buffer."],
        });
      } else if (actual <= input.expectedDonePercent - 0.2) {
        out.push({
          ...base, id: id(input.tenant, input.launchId, "behind_schedule", String(Math.round(actual * 100))),
          campaignId: null, kind: "behind_schedule", severity: "warn",
          title: "Campaign is behind schedule",
          body: `${Math.round(actual * 100)}% of items are done against ${Math.round(input.expectedDonePercent * 100)}% expected.`,
          action: "schedule everything", detail: ["Automatic scheduling can close the gap without new work."],
        });
      }
    }

    return out;
  }

  /** Apply stored dismissals to a derived set, dropping anything already dealt with. */
  merge(derived: Notification[], dismissed: Record<string, number>): Notification[] {
    // Ids are content-addressed, so two identical findings are one notification. Collapsing
    // here means a duplicate can never reach the UI even if a caller derives one twice.
    const unique = new Map(derived.map((n) => [n.id, n]));
    return [...unique.values()]
      .filter((n) => !dismissed[n.id])
      .sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || b.at - a.at);
  }
}

const SEVERITY: Record<Notification["severity"], number> = { critical: 3, warn: 2, info: 1 };
