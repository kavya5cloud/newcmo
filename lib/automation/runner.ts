import { createAdapterRegistry } from "@/lib/social/registry";
import type { ConnectedAccount, SocialPlatform } from "@/lib/social/types";
import { materialize, setState } from "./engine";
import { prePublish, type PrePublishResult } from "./prepublish";
import type { Automation, QueueItem } from "./types";

// Executing a due slot.
//
// The entire publishing act — adapter call, retry, backoff, dead-letter, history — belongs
// to the M12 Publishing Engine. This file decides *whether* a slot may run, hands it over,
// and records what came back. It contains no HTTP call to any platform, by design.
//
// Two properties matter more than anything else here:
//
//   Locking. A slot moves upcoming → publishing before any work starts, and the move is
//   rejected if it is not currently upcoming. Two overlapping cron runs therefore cannot
//   both claim the same slot.
//
//   Idempotency. The publish request carries an idempotency key derived from the slot id,
//   which the Publishing Engine already de-duplicates on. Even if the lock were somehow
//   bypassed — a crash between claim and publish, a replayed request — the same slot can
//   never post twice.

export type PreflightFailure = {
  code: "no_account" | "disconnected" | "token_expired" | "media_required" | "unsupported_platform";
  /** What the operator sees. Plain language, with the fix. */
  message: string;
  /** Whether retrying unchanged could ever succeed. */
  retryable: boolean;
};

export type Preflight =
  | { ok: true; account: ConnectedAccount }
  | { ok: false; failure: PreflightFailure };

/**
 * Everything that must be true before a slot is allowed near a platform.
 *
 * Failures are separated into retryable and not: a rate limit clears on its own, a
 * revoked token never does. Retrying the second forever is how a queue fills with noise
 * that hides the one problem a human has to fix.
 */
export function preflight(
  slot: QueueItem,
  accounts: ConnectedAccount[],
  opts: { hasMedia?: boolean; now: number },
): Preflight {
  const registry = createAdapterRegistry();
  const adapter = registry.get(slot.platform as SocialPlatform);
  if (!adapter) {
    return { ok: false, failure: { code: "unsupported_platform", message: `${slot.platform} has no adapter.`, retryable: false } };
  }

  const forPlatform = accounts.filter((a) => a.platform === slot.platform);
  if (forPlatform.length === 0) {
    return {
      ok: false,
      failure: { code: "no_account", message: `No ${slot.platform} account is connected. Connect one in Cross-Post.`, retryable: false },
    };
  }

  const connected = forPlatform.find((a) => a.status === "connected");
  if (!connected) {
    return {
      ok: false,
      failure: { code: "disconnected", message: `The ${slot.platform} account needs reconnecting.`, retryable: false },
    };
  }

  // An expired token is a human problem, not a transient one — say so rather than
  // burning retries against a credential that cannot refresh itself.
  if (connected.tokenExpiresAt != null && connected.tokenExpiresAt <= opts.now) {
    return {
      ok: false,
      failure: { code: "token_expired", message: `The ${slot.platform} connection has expired. Reconnect it to resume this schedule.`, retryable: false },
    };
  }

  const constraints = adapter.constraints();
  if (constraints.requiresAsset && !opts.hasMedia) {
    return {
      ok: false,
      failure: { code: "media_required", message: `${slot.platform} requires media, and this slot has none attached.`, retryable: false },
    };
  }

  return { ok: true, account: connected };
}

export type PublishOutcome = {
  slotId: string;
  ok: boolean;
  jobId: string | null;
  state: QueueItem["state"];
  message: string;
};

/** The publishing surface this runner needs. Narrow on purpose: it is the M12 engine. */
export type PublishPort = {
  listAccounts(tenant: string): Promise<ConnectedAccount[]>;
  publishNow(req: {
    tenant: string; accountId: string; platform: SocialPlatform;
    content: { text: string; assetIds: string[] }; assets: never[]; idempotencyKey: string;
  }): Promise<{ id: string; state: string; error: string | null }>;
};

/** Where a slot's text comes from. Supplied by the caller so sources stay swappable. */
export type ContentPort = (slot: QueueItem) => Promise<{ text: string; assetIds: string[] } | null>;

export type RunOptions = {
  now: number;
  engine: PublishPort;
  content: ContentPort;
  /** Cap per run so one tenant with a huge backlog can't monopolise a cron minute. */
  max?: number;
  /** Brand/market context handed to the optimiser. Assembled by the caller. */
  contextPrompt?: string;
  /** Already-scheduled text, so the pipeline can catch a duplicate before it posts. */
  scheduledTexts?: string[];
  /** Called with the pipeline result for each slot, for logging and Learning. */
  onOptimized?: (slotId: string, result: PrePublishResult) => void;
};

/**
 * Claim and publish every slot that is due.
 *
 * Returns the updated queue plus one outcome per slot attempted, so the caller can log
 * and the UI can explain. Slots that fail preflight are marked failed with the reason
 * rather than retried blindly.
 */
export async function runDue(
  queue: QueueItem[],
  tenant: string,
  opts: RunOptions,
): Promise<{ queue: QueueItem[]; outcomes: PublishOutcome[] }> {
  const outcomes: PublishOutcome[] = [];
  let working = queue;

  const ready = working
    .filter((q) => q.state === "upcoming" && q.at <= opts.now)
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .slice(0, opts.max ?? 25);

  if (ready.length === 0) return { queue: working, outcomes };

  const accounts = await opts.engine.listAccounts(tenant).catch(() => [] as ConnectedAccount[]);

  for (const slot of ready) {
    // Claim first. If this fails, another run already took it — skip without comment.
    const claim = setState(working, slot.id, "publishing");
    if (!claim.ok) continue;
    working = claim.queue;

    const body = await opts.content(slot).catch(() => null);
    const check = preflight(slot, accounts, { hasMedia: Boolean(body?.assetIds.length), now: opts.now });

    if (!check.ok) {
      const r = setState(working, slot.id, "failed", check.failure.message);
      working = r.queue;
      outcomes.push({ slotId: slot.id, ok: false, jobId: null, state: "failed", message: check.failure.message });
      continue;
    }

    if (!body || !body.text.trim()) {
      const message = "No content was available for this slot.";
      const r = setState(working, slot.id, "failed", message);
      working = r.queue;
      outcomes.push({ slotId: slot.id, ok: false, jobId: null, state: "failed", message });
      continue;
    }

    // Every slot goes through the one pre-publish pipeline, whatever wrote it. A draft
    // and a generated post are held to the same limits, links and accessibility rules.
    const pipeline = await prePublish(
      { text: body.text, assetIds: body.assetIds },
      { platform: slot.platform as SocialPlatform, contextPrompt: opts.contextPrompt, scheduledTexts: opts.scheduledTexts },
    ).catch(() => null);

    if (pipeline) opts.onOptimized?.(slot.id, pipeline);

    // Validation is the only thing allowed to block. Optimisation failing just means the
    // original ships — shipping the original beats shipping nothing.
    if (pipeline && !pipeline.validation.ok) {
      const why = pipeline.validation.errors.map((e) => e.message).join(" ");
      const r = setState(working, slot.id, "failed", why);
      working = r.queue;
      outcomes.push({ slotId: slot.id, ok: false, jobId: null, state: "failed", message: why });
      continue;
    }

    const finalContent = pipeline?.publishable ?? { text: body.text, assetIds: body.assetIds };

    try {
      const job = await opts.engine.publishNow({
        tenant, accountId: check.account.id, platform: slot.platform,
        content: { text: finalContent.text, assetIds: finalContent.assetIds },
        assets: [],
        // The slot id is the idempotency key: the Publishing Engine will not run the
        // same key twice, whatever happens to this process in between.
        idempotencyKey: `automation:${slot.id}`,
      });

      const published = job.state === "published";
      const r = setState(working, slot.id, published ? "published" : "failed", job.error ?? undefined);
      working = r.queue;
      working = working.map((q) => (q.id === slot.id ? { ...q, jobId: job.id } : q));
      outcomes.push({
        slotId: slot.id, ok: published, jobId: job.id,
        state: published ? "published" : "failed",
        message: published ? `Published to ${slot.platform}.` : (job.error ?? "The platform rejected it."),
      });
    } catch (e) {
      // A thrown engine is transient by assumption — the slot goes to failed, which the
      // retry path can pick up, rather than vanishing.
      const message = String(e).slice(0, 200);
      const r = setState(working, slot.id, "failed", message);
      working = r.queue;
      outcomes.push({ slotId: slot.id, ok: false, jobId: null, state: "failed", message });
    }
  }

  return { queue: working, outcomes };
}

/**
 * Retry failures whose cause could plausibly have cleared.
 *
 * Backoff is exponential on the attempt count encoded in the note; nothing is retried
 * more than `maxAttempts` times, because a queue that retries forever is a queue nobody
 * reads.
 */
export function retryFailed(
  queue: QueueItem[],
  opts: { now: number; maxAttempts?: number },
): { queue: QueueItem[]; retried: string[] } {
  const max = opts.maxAttempts ?? 3;
  const retried: string[] = [];

  const next = queue.map((slot) => {
    if (slot.state !== "failed") return slot;
    const attempts = Number(/attempt (\d+)/.exec(slot.note ?? "")?.[1] ?? 0);
    if (attempts >= max) return slot;                       // give up loudly, not silently
    // 1m, 2m, 4m — the same backoff shape the Publishing Engine uses for its own retries.
    const waitMs = 60_000 * Math.pow(2, attempts);
    if (opts.now < slot.at + waitMs) return slot;           // not due for another try yet
    retried.push(slot.id);
    // Straight back to upcoming: the next run claims it through the normal publish path,
    // so retries and first attempts share one code path rather than drifting apart.
    return { ...slot, state: "upcoming" as const, note: `attempt ${attempts + 1}` };
  });

  return { queue: next, retried };
}

/**
 * Extend the queue after a run so a recurring automation never runs dry.
 *
 * `materialize` is idempotent, so this only ever adds slots that don't exist — a
 * published slot is never regenerated.
 */
export function extend(automations: Automation[], queue: QueueItem[], now: number, horizonDays = 14): QueueItem[] {
  return materialize(automations, queue, { from: now, horizonDays });
}
