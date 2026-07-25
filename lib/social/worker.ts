import type { AdapterRegistry } from "./registry";
import { OAuthService } from "./oauth";
import type { OAuthToken, PublishJob, PublishRequest, PublishResult } from "./types";

// Publisher Worker — executes ONE publish job THROUGH an adapter only. It knows nothing
// platform-specific: it validates the connection, refreshes the token if needed, then calls
// the adapter's publish(). Token refresh is surfaced so the engine can re-persist it.

export type WorkerDeps = {
  registry: AdapterRegistry;
  oauth: OAuthService;
  now: () => number;
};

export type WorkerOutcome = {
  result: PublishResult;
  refreshedToken: OAuthToken | null;    // set when the token was refreshed (re-persist it)
};

/** Execute a job via its platform adapter. Never contains platform logic. */
export async function executeJob(job: PublishJob, token: OAuthToken, deps: WorkerDeps): Promise<WorkerOutcome> {
  const adapter = deps.registry.get(job.platform);
  if (!adapter) return { result: { ok: false, platform: job.platform, error: "no_adapter", at: deps.now() }, refreshedToken: null };

  // Validate + refresh the token before publishing.
  let activeToken = token;
  let refreshedToken: OAuthToken | null = null;
  const check = await adapter.validateConnection(activeToken);
  if (!check.ok || deps.oauth.needsRefresh(activeToken)) {
    activeToken = await adapter.refreshToken(activeToken);
    refreshedToken = activeToken;
    const recheck = await adapter.validateConnection(activeToken);
    if (!recheck.ok) {
      return { result: { ok: false, platform: job.platform, error: `connection ${recheck.status}`, at: deps.now() }, refreshedToken };
    }
  }

  const req: PublishRequest = {
    tenant: job.tenant, accountId: job.accountId, platform: job.platform,
    content: job.content, assets: job.assets, idempotencyKey: job.idempotencyKey ?? undefined,
  };
  const result = await adapter.publish(req, activeToken);
  return { result, refreshedToken };
}
