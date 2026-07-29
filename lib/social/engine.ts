import { AdapterRegistry, createAdapterRegistry } from "./registry";
import {
  OAuthService, InMemoryCredentialStore, sealToken, openToken, type CredentialStore,
} from "./oauth";
import { executeJob } from "./worker";
import { backoffMs, isDue } from "./scheduler";
import {
  InMemoryAccountStore, InMemoryDraftStore, InMemoryHistoryStore, InMemoryJobStore,
  type AccountStore, type DraftStore, type HistoryStore, type JobStore,
} from "./store";
import {
  type ConnectedAccount, type Draft, type OAuthToken, type PostContent, type PublishJob,
  type PublishRequest, type QueueMetrics, type SocialPlatform, type Asset, type ConnectionCheck,
} from "./types";

// Cross-Platform Publishing Engine — the facade. Owns the queue and orchestrates accounts,
// OAuth, drafts, publishing, scheduling, retry (exponential backoff), the dead-letter queue
// and idempotency. Execution always goes THROUGH adapters (worker.ts); no platform logic
// lives here. Structured logging + monitoring throughout.

let seq = 0;

export type SocialStores = {
  accounts?: AccountStore; drafts?: DraftStore; jobs?: JobStore; history?: HistoryStore; credentials?: CredentialStore;
};
export type EngineOptions = { now?: () => number; maxRetries?: number; stores?: SocialStores; registry?: AdapterRegistry };

export class SocialPublishingEngine {
  private now: () => number;
  private maxRetries: number;
  readonly registry: AdapterRegistry;
  private oauth: OAuthService;
  private accounts: AccountStore;
  private drafts: DraftStore;
  private jobs: JobStore;
  private history: HistoryStore;
  private credentials: CredentialStore;
  private idem = new Map<string, string>();      // idempotencyKey → jobId
  private jobMem = new Map<string, PublishJob>(); // fast working set

  constructor(opts: EngineOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.maxRetries = opts.maxRetries ?? 3;
    this.registry = opts.registry ?? createAdapterRegistry(this.now);
    this.oauth = new OAuthService({ now: this.now });
    this.accounts = opts.stores?.accounts ?? new InMemoryAccountStore();
    this.drafts = opts.stores?.drafts ?? new InMemoryDraftStore();
    this.jobs = opts.stores?.jobs ?? new InMemoryJobStore();
    this.history = opts.stores?.history ?? new InMemoryHistoryStore();
    this.credentials = opts.stores?.credentials ?? new InMemoryCredentialStore();
  }

  // ---- Accounts + OAuth ----

  oauthBegin(platform: SocialPlatform, redirectUri: string, state: string) { return this.oauth.begin(platform, redirectUri, state); }

  async connectAccount(tenant: string, platform: SocialPlatform, code: string, handle?: string): Promise<ConnectedAccount> {
    const token = await this.oauth.complete(platform, code, handle);
    const id = `acc_${platform}_${token.externalId}`;
    const account: ConnectedAccount = {
      id, tenant, platform, handle: token.handle, externalId: token.externalId,
      status: "connected", scopes: token.scopes, connectedAt: this.now(), tokenExpiresAt: token.expiresAt,
    };
    await this.accounts.save(account);
    await this.credentials.save(sealToken(id, platform, token)); // token stored ENCRYPTED
    console.info(JSON.stringify({ event: "social_connect", tenant, platform, account: id }));
    return account;
  }

  async disconnectAccount(id: string): Promise<boolean> {
    const account = await this.accounts.get(id);
    if (!account) return false;
    await this.accounts.save({ ...account, status: "disconnected" });
    await this.credentials.remove(id);
    return true;
  }

  listAccounts(tenant: string) { return this.accounts.list(tenant); }

  async validateAccount(id: string): Promise<ConnectionCheck> {
    const account = await this.accounts.get(id);
    if (!account) return { ok: false, status: "disconnected", detail: "no account" };
    const token = await this.token(id);
    if (!token) return { ok: false, status: "disconnected", detail: "no credential" };
    return this.registry.get(account.platform)!.validateConnection(token);
  }

  private async token(accountId: string): Promise<OAuthToken | null> {
    const cred = await this.credentials.get(accountId);
    return cred ? openToken(cred) : null;
  }

  // ---- Drafts (CRUD) ----

  async createDraft(tenant: string, title: string, platforms: SocialPlatform[], content: PostContent): Promise<Draft> {
    const d: Draft = { id: `draft_${(seq++).toString(36)}_${this.now().toString(36)}`, tenant, title, platforms, content, createdAt: this.now(), updatedAt: this.now() };
    await this.drafts.save(d); return d;
  }
  async updateDraft(id: string, patch: Partial<Pick<Draft, "title" | "platforms" | "content">>): Promise<Draft | null> {
    const d = await this.drafts.get(id); if (!d) return null;
    const next = { ...d, ...patch, updatedAt: this.now() }; await this.drafts.save(next); return next;
  }
  getDraft(id: string) { return this.drafts.get(id); }
  listDrafts(tenant: string) { return this.drafts.list(tenant); }
  deleteDraft(id: string) { return this.drafts.remove(id); }

  // ---- Publishing ----

  private newJob(req: PublishRequest, scheduledAt: number | null, timezone: string | null): PublishJob {
    return {
      id: `pub_${(seq++).toString(36)}_${this.now().toString(36)}`,
      tenant: req.tenant, accountId: req.accountId, platform: req.platform,
      content: req.content, assets: req.assets,
      state: scheduledAt ? "scheduled" : "queued", attempts: 0, maxRetries: this.maxRetries,
      scheduledAt, timezone, nextAttemptAt: null, idempotencyKey: req.idempotencyKey ?? null,
      result: null, error: null, createdAt: this.now(), updatedAt: this.now(), logs: [],
    };
  }

  private async persist(job: PublishJob) { this.jobMem.set(job.id, job); await this.jobs.save(job); }
  private log(job: PublishJob, level: "info" | "warn" | "error", message: string) {
    job.logs.push({ at: this.now(), level, message });
    console.info(JSON.stringify({ event: "social_job", jobId: job.id, platform: job.platform, level, message }));
  }

  /** Publish immediately. Idempotent on idempotencyKey. */
  async publishNow(req: PublishRequest): Promise<PublishJob> {
    if (req.idempotencyKey && this.idem.has(req.idempotencyKey)) return this.jobMem.get(this.idem.get(req.idempotencyKey)!)!;
    const job = this.newJob(req, null, null);
    if (req.idempotencyKey) this.idem.set(req.idempotencyKey, job.id);
    await this.persist(job);
    await this.runJob(job.id);
    return this.jobMem.get(job.id)!;
  }

  /** Schedule for a UTC epoch (compute it from a timezone via lib/social/scheduler). */
  async schedule(req: PublishRequest, at: number, timezone: string): Promise<PublishJob> {
    if (req.idempotencyKey && this.idem.has(req.idempotencyKey)) return this.jobMem.get(this.idem.get(req.idempotencyKey)!)!;
    const job = this.newJob(req, at, timezone);
    if (req.idempotencyKey) this.idem.set(req.idempotencyKey, job.id);
    this.log(job, "info", `Scheduled for ${new Date(at).toISOString()} (${timezone})`);
    await this.persist(job);
    return job;
  }

  /** Run a single job through its adapter, handling retry/backoff/DLQ + history. */
  async runJob(id: string): Promise<PublishJob | null> {
    const job = this.jobMem.get(id) ?? (await this.jobs.get(id));
    if (!job) return null;
    if (job.state === "cancelled" || job.state === "published" || job.state === "dead_letter") return job;

    const account = await this.accounts.get(job.accountId);
    const token = await this.token(job.accountId);
    if (!account || account.status !== "connected" || !token) {
      job.state = "failed"; job.error = "account_not_connected"; this.log(job, "error", "Account not connected");
      job.attempts += 1; await this.finalizeFailure(job); return job;
    }

    job.state = "publishing"; job.attempts += 1; job.updatedAt = this.now();
    this.log(job, "info", `Publishing to ${job.platform} (attempt ${job.attempts})`);
    await this.persist(job);

    const { result, refreshedToken } = await executeJob(job, token, { registry: this.registry, oauth: this.oauth, now: this.now });
    if (refreshedToken) { // re-persist the refreshed token (still encrypted)
      await this.credentials.save(sealToken(job.accountId, job.platform, refreshedToken));
      await this.accounts.save({ ...account, tokenExpiresAt: refreshedToken.expiresAt });
      this.log(job, "info", "Access token refreshed");
    }

    job.result = result; job.updatedAt = this.now();
    if (result.ok) {
      job.state = "published"; job.error = null;
      this.log(job, "info", `Published: ${result.permalink}`);
      await this.appendHistory(job);
    } else {
      job.error = result.error ?? "publish_failed";
      await this.finalizeFailure(job);
    }
    await this.persist(job);
    return job;
  }

  private async finalizeFailure(job: PublishJob) {
    if (job.attempts <= job.maxRetries) {
      job.state = "queued";
      job.nextAttemptAt = this.now() + backoffMs(job.attempts);
      this.log(job, "warn", `Retry ${job.attempts}/${job.maxRetries} after backoff (${backoffMs(job.attempts)}ms): ${job.error}`);
    } else {
      job.state = "dead_letter";
      this.log(job, "error", `Dead-letter after ${job.attempts} attempts: ${job.error}`);
      await this.appendHistory(job);
    }
    await this.persist(job);
  }

  private async appendHistory(job: PublishJob) {
    await this.history.append({
      id: `hist_${job.id}`, tenant: job.tenant, jobId: job.id, accountId: job.accountId, platform: job.platform,
      state: job.state, externalId: job.result?.externalId ?? null, permalink: job.result?.permalink ?? null,
      attempts: job.attempts, publishedAt: job.state === "published" ? this.now() : null, error: job.error,
    });
  }

  /** Dispatch every due job (scheduled time reached + backoff elapsed). Run repeatedly.
   *
   * The cron worker may run in a different serverless instance from the request that
   * created the job, so always refresh the working set from the durable job store first.
   */
  async dispatchDue(now = this.now()): Promise<PublishJob[]> {
    const stored = await this.jobs.list();
    for (const job of stored) {
      if (!this.jobMem.has(job.id) || this.jobMem.get(job.id)!.updatedAt < job.updatedAt) {
        this.jobMem.set(job.id, job);
      }
    }
    const due = [...this.jobMem.values()].filter((j) => isDue(j, now));
    const out: PublishJob[] = [];
    for (const j of due) out.push((await this.runJob(j.id))!);
    return out;
  }

  async retry(id: string): Promise<PublishJob | null> {
    const job = this.jobMem.get(id) ?? (await this.jobs.get(id));
    if (!job || (job.state !== "failed" && job.state !== "dead_letter")) return job ?? null;
    job.state = "queued"; job.error = null; job.nextAttemptAt = null; job.attempts = 0;
    this.log(job, "info", "Manual retry"); await this.persist(job);
    return this.runJob(id);
  }

  async cancel(id: string): Promise<boolean> {
    const job = this.jobMem.get(id) ?? (await this.jobs.get(id));
    if (!job || job.state === "published" || job.state === "cancelled") return false;
    job.state = "cancelled"; job.updatedAt = this.now(); this.log(job, "info", "Cancelled"); await this.persist(job);
    return true;
  }

  /**
   * Apply a normalized platform webhook (see webhooks.ts). Platform callbacks are the
   * source of truth AFTER dispatch: a provider can confirm, fail or delete a post
   * asynchronously, and a revoked token must mark the account disconnected.
   * Returns what changed so the API can report it.
   */
  async applyWebhook(e: {
    platform: SocialPlatform; type: string; externalId: string | null;
    accountExternalId: string | null; permalink: string | null; error: string | null;
  }): Promise<{ applied: boolean; jobId?: string; accountId?: string; change?: string }> {
    // Token revocation → mark the account disconnected so nothing publishes with it.
    if (e.type === "token.revoked") {
      const all = [...this.jobMem.values()];
      const accId = e.accountExternalId ? `acc_${e.platform}_${e.accountExternalId}` : all.find((j) => j.platform === e.platform)?.accountId;
      if (!accId) return { applied: false };
      const account = await this.accounts.get(accId);
      if (!account) return { applied: false };
      await this.accounts.save({ ...account, status: "disconnected" });
      await this.credentials.remove(accId);
      console.info(JSON.stringify({ event: "social_webhook", type: e.type, platform: e.platform, account: accId }));
      return { applied: true, accountId: accId, change: "account_disconnected" };
    }

    if (!e.externalId) return { applied: false };
    const job = [...this.jobMem.values()].find((j) => j.result?.externalId === e.externalId);
    if (!job) return { applied: false };

    if (e.type === "publish.confirmed") {
      job.state = "published";
      job.error = null;
      if (job.result) job.result = { ...job.result, ok: true, permalink: e.permalink ?? job.result.permalink };
      this.log(job, "info", "Platform confirmed publish");
    } else if (e.type === "publish.failed") {
      job.error = e.error ?? "platform_reported_failure";
      this.log(job, "error", `Platform reported failure: ${job.error}`);
      await this.finalizeFailure(job);
    } else if (e.type === "post.deleted") {
      job.state = "cancelled";
      this.log(job, "warn", "Post deleted on the platform");
    } else {
      return { applied: false, jobId: job.id };
    }

    job.updatedAt = this.now();
    await this.persist(job);
    await this.appendHistory(job);
    console.info(JSON.stringify({ event: "social_webhook", type: e.type, platform: e.platform, jobId: job.id }));
    return { applied: true, jobId: job.id, change: job.state };
  }

  getJob(id: string) { return this.jobMem.get(id) ?? this.jobs.get(id); }
  listJobs(tenant?: string) { return this.jobs.list(tenant); }
  listHistory(tenant: string) { return this.history.list(tenant); }

  /** Scheduled jobs for a calendar view. */
  scheduledJobs(tenant: string): PublishJob[] {
    return [...this.jobMem.values()].filter((j) => j.tenant === tenant && j.state === "scheduled").sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  }

  metrics(tenant?: string): QueueMetrics {
    const all = [...this.jobMem.values()].filter((j) => !tenant || j.tenant === tenant);
    const c = (s: PublishJob["state"]) => all.filter((j) => j.state === s).length;
    const retrying = all.filter((j) => j.state === "queued" && j.attempts > 0).length;
    const attempted = all.filter((j) => j.attempts > 0);
    return {
      queued: c("queued"), scheduled: c("scheduled"), publishing: c("publishing"), published: c("published"),
      failed: c("failed"), deadLetter: c("dead_letter"), retrying,
      avgAttempts: attempted.length ? Math.round((attempted.reduce((s, j) => s + j.attempts, 0) / attempted.length) * 100) / 100 : 0,
    };
  }

  /** Helper to turn asset descriptors into Asset objects (multiple assets per post). */
  static asset(kind: Asset["kind"], uri: string, mime: string, alt?: string): Asset {
    return { id: `ast_${uri.length}_${mime.length}_${uri.slice(-6)}`, kind, uri, mime, altText: alt };
  }
}
