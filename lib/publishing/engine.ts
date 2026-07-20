import { PublishingQueue, type AdvanceResult, type PublishItem } from "@/lib/launch/publishing";
import { flagDependents } from "@/lib/launch/dependencies";
import type { LaunchDependencyGraph, PublishSlot, PublishStage } from "@/lib/launch/types";
import { EventBus } from "./events";
import type { PublishEventType } from "./types";

// Publishing Engine — the event-driven lifecycle. It wraps the Milestone 7
// PublishingQueue (no duplicated state-machine logic) and adds: event emission on every
// transition, an APPROVAL GATE (nothing reaches `scheduled` without an approval), and
// DEPENDENCY FLAGGING (when an upstream asset changes, dependents drop to needs-review).
//
// Publishing never bypasses the Asset Graph lifecycle or approval — both are enforced here.

const EVENT_FOR_STAGE: Record<PublishStage, PublishEventType> = {
  draft: "asset.drafted",
  creative_review: "asset.evaluated",
  approval: "asset.approved",
  scheduled: "asset.scheduled",
  publishing: "asset.publishing",
  published: "asset.published",
  measured: "asset.measured",
  archived: "asset.archived",
};

export type EngineOptions = {
  now?: () => number;
  dependencyGraph?: LaunchDependencyGraph;
};

export class PublishingEngine {
  readonly bus = new EventBus();
  private queue: PublishingQueue;
  private now: () => number;
  private graph?: LaunchDependencyGraph;
  private approved = new Set<string>();
  private needsReview = new Set<string>();

  constructor(opts: EngineOptions = {}) {
    this.now = opts.now ?? (() => 0);
    this.graph = opts.dependencyGraph;
    this.queue = new PublishingQueue({ now: this.now });
  }

  load(slots: PublishSlot[]): this {
    this.queue.load(slots);
    for (const s of slots) this.bus.emit({ type: EVENT_FOR_STAGE[s.stage], assetKey: s.assetKey, stage: s.stage, at: this.now() });
    return this;
  }

  add(assetKey: string, stage: PublishStage = "draft"): PublishItem {
    const item = this.queue.add(assetKey, stage);
    this.bus.emit({ type: "asset.drafted", assetKey, stage, at: this.now() });
    return item;
  }

  get(assetKey: string) { return this.queue.get(assetKey); }
  all() { return this.queue.all(); }
  summary() { return this.queue.summary(); }

  /**
   * Advance an asset one stage. Enforces the approval gate: approval → scheduled is only
   * allowed once the asset has been approved (see approve()). Emits a lifecycle event.
   */
  advance(assetKey: string, opts: { shouldFail?: boolean } = {}): AdvanceResult {
    const item = this.queue.get(assetKey);
    if (item && item.stage === "approval" && !this.approved.has(assetKey)) {
      return { ok: false, item, error: "approval_required" };
    }
    const res = this.queue.advance(assetKey, opts);
    if (res.ok) {
      this.bus.emit({ type: EVENT_FOR_STAGE[res.item.stage], assetKey, stage: res.item.stage, at: this.now() });
    } else if (res.error === "publish_failed") {
      this.bus.emit({ type: "asset.failed", assetKey, stage: res.item.stage, at: this.now(), data: { error: res.error } });
    }
    return res;
  }

  /** Grant approval (unlocks approval → scheduled) and advance. */
  approve(assetKey: string): AdvanceResult {
    this.approved.add(assetKey);
    this.needsReview.delete(assetKey);
    const item = this.queue.get(assetKey);
    if (item && item.stage === "approval") return this.advance(assetKey);
    return { ok: true, item: item ?? this.queue.add(assetKey), error: item ? undefined : "not_found" };
  }

  /** Reject an asset — send it back to creative review. */
  reject(assetKey: string): AdvanceResult {
    this.approved.delete(assetKey);
    const item = this.queue.get(assetKey);
    if (!item) return { ok: false, item: this.queue.add(assetKey), error: "not_found" };
    // Roll back to creative_review regardless of current stage.
    while (this.queue.get(assetKey)!.stage !== "creative_review" && this.queue.get(assetKey)!.stage !== "draft") {
      const r = this.queue.rollback(assetKey);
      if (!r.ok) break;
    }
    this.bus.emit({ type: "asset.rejected", assetKey, stage: this.queue.get(assetKey)!.stage, at: this.now() });
    return { ok: true, item: this.queue.get(assetKey)! };
  }

  retry(assetKey: string, opts: { shouldFail?: boolean } = {}): AdvanceResult {
    const res = this.queue.retry(assetKey, opts);
    this.bus.emit({ type: "asset.retried", assetKey, stage: res.item.stage, at: this.now(), data: { ok: res.ok } });
    return res;
  }

  rollback(assetKey: string): AdvanceResult {
    const res = this.queue.rollback(assetKey);
    if (res.ok) this.bus.emit({ type: "asset.rolledback", assetKey, stage: res.item.stage, at: this.now() });
    return res;
  }

  /** Bulk publish: advance many assets one step, emitting events for each. */
  bulkAdvance(assetKeys: string[], opts: { shouldFail?: (k: string) => boolean } = {}): AdvanceResult[] {
    return assetKeys.map((k) => this.advance(k, { shouldFail: opts.shouldFail?.(k) }));
  }

  /**
   * An upstream asset changed — every downstream dependent must be re-reviewed (Part 5).
   * Requires the dependency graph. Flagged assets roll back to creative_review and their
   * approval is revoked; a needs_review event is emitted per dependent.
   */
  markUpstreamChanged(assetKey: string): string[] {
    if (!this.graph) return [];
    const dependents = flagDependents(this.graph, assetKey);
    for (const dep of dependents) {
      this.needsReview.add(dep);
      this.approved.delete(dep);
      const item = this.queue.get(dep);
      if (item) {
        while (this.queue.get(dep)!.stage !== "creative_review" && this.queue.get(dep)!.stage !== "draft" && this.queue.rollback(dep).ok) { /* roll back to review */ }
      }
      this.bus.emit({ type: "asset.needs_review", assetKey: dep, at: this.now(), data: { changedUpstream: assetKey } });
    }
    return dependents;
  }

  isApproved(assetKey: string) { return this.approved.has(assetKey); }
  needsReviewKeys() { return [...this.needsReview]; }
}
