import { type Sql, RUNTIME_DDL } from "@/lib/db";
import { open, seal } from "./crypto";
import type { IntegrationCredential, OAuthToken, SocialPlatform } from "./types";

// OAuth Service — begins the auth flow, completes it into a token, refreshes tokens, and
// stores them ENCRYPTED. Reference implementation (no vendor SDKs): the flow is
// deterministic so the whole system runs and is testable without real providers. Real
// OAuth swaps in here with zero changes to callers.

const SCOPES: Record<SocialPlatform, string[]> = {
  linkedin: ["w_member_social", "r_liteprofile"],
  instagram_business: ["instagram_content_publish", "pages_show_list"],
  facebook_pages: ["pages_manage_posts", "pages_read_engagement"],
  x: ["tweet.write", "users.read", "offline.access"],
  threads: ["threads_content_publish", "threads_basic"],
  pinterest: ["pins:write", "boards:read"],
};

const TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

export class OAuthService {
  private now: () => number;
  constructor(opts: { now?: () => number } = {}) { this.now = opts.now ?? Date.now; }

  /** Step 1 — the provider consent URL the user is sent to (provider-neutral in reference mode). */
  begin(platform: SocialPlatform, redirectUri: string, state: string): { authUrl: string; scopes: string[] } {
    const scopes = SCOPES[platform];
    const authUrl = `populr://oauth/${platform}/authorize?scope=${encodeURIComponent(scopes.join(" "))}&state=${encodeURIComponent(state)}&redirect=${encodeURIComponent(redirectUri)}`;
    return { authUrl, scopes };
  }

  /** Step 2 — exchange the returned code for a token bundle. Deterministic in reference mode. */
  async complete(platform: SocialPlatform, code: string, handle?: string): Promise<OAuthToken> {
    const externalId = `${platform}_${code.slice(0, 8)}`;
    return {
      accessToken: `at_${platform}_${code}`,
      refreshToken: `rt_${platform}_${code}`,
      expiresAt: this.now() + TOKEN_TTL_MS,
      scopes: SCOPES[platform],
      externalId,
      handle: handle || `@${platform}_account`,
    };
  }

  /** Refresh an access token using the refresh token. */
  async refresh(token: OAuthToken): Promise<OAuthToken> {
    return { ...token, accessToken: `at_${token.externalId}_${this.now()}`, expiresAt: this.now() + TOKEN_TTL_MS };
  }

  /** Whether a token is expired (or within a 1-day refresh window). */
  needsRefresh(token: OAuthToken): boolean {
    return token.expiresAt != null && token.expiresAt - this.now() < 24 * 60 * 60 * 1000;
  }
}

// ---- Encrypted credential store (Integration Credentials) ----

export function sealToken(accountId: string, platform: SocialPlatform, token: OAuthToken): IntegrationCredential {
  const sealed = seal(JSON.stringify(token));
  return { accountId, platform, ciphertext: sealed.ciphertext, iv: sealed.iv, tag: sealed.tag, expiresAt: token.expiresAt };
}
export function openToken(cred: IntegrationCredential): OAuthToken {
  return JSON.parse(open({ ciphertext: cred.ciphertext, iv: cred.iv, tag: cred.tag })) as OAuthToken;
}

export interface CredentialStore {
  save(cred: IntegrationCredential): Promise<void>;
  get(accountId: string): Promise<IntegrationCredential | null>;
  remove(accountId: string): Promise<void>;
}

export class InMemoryCredentialStore implements CredentialStore {
  private map = new Map<string, IntegrationCredential>();
  async save(c: IntegrationCredential) { this.map.set(c.accountId, c); }
  async get(id: string) { return this.map.get(id) ?? null; }
  async remove(id: string) { this.map.delete(id); }
}

let credReady = false;
async function ensureCredTable(sql: Sql) {
  if (credReady) return;
  if (!RUNTIME_DDL) { credReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS social_credentials (
    account_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    expires_at BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  credReady = true;
}

export class NeonCredentialStore implements CredentialStore {
  constructor(private sql: Sql) {}
  async save(c: IntegrationCredential) {
    await ensureCredTable(this.sql);
    await this.sql`INSERT INTO social_credentials (account_id, platform, ciphertext, iv, tag, expires_at)
      VALUES (${c.accountId}, ${c.platform}, ${c.ciphertext}, ${c.iv}, ${c.tag}, ${c.expiresAt})
      ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, tag = EXCLUDED.tag, expires_at = EXCLUDED.expires_at, updated_at = now()`;
  }
  async get(id: string) {
    await ensureCredTable(this.sql);
    const rows = (await this.sql`SELECT account_id, platform, ciphertext, iv, tag, expires_at FROM social_credentials WHERE account_id = ${id}`) as Record<string, unknown>[];
    const r = rows[0];
    return r ? { accountId: String(r.account_id), platform: r.platform as SocialPlatform, ciphertext: String(r.ciphertext), iv: String(r.iv), tag: String(r.tag), expiresAt: r.expires_at == null ? null : Number(r.expires_at) } : null;
  }
  async remove(id: string) { await ensureCredTable(this.sql); await this.sql`DELETE FROM social_credentials WHERE account_id = ${id}`; }
}
