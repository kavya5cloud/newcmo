-- Cross-Platform Publishing System (Milestone 12). Apply with `npm run db:migrate`.
-- Connected accounts, encrypted credentials, drafts, publishing jobs / scheduled posts and
-- publish history. Tokens are stored AES-256-GCM encrypted (never plaintext). Runtime
-- ensure* guards mirror these for dev/test. Additive — does not touch existing tables.

CREATE TABLE IF NOT EXISTS social_accounts (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL,
  token_expires_at BIGINT,
  data JSONB NOT NULL,
  connected_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_accounts_tenant ON social_accounts (tenant);

CREATE TABLE IF NOT EXISTS social_credentials (
  account_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  tag TEXT NOT NULL,
  expires_at BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS social_drafts (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  title TEXT NOT NULL,
  data JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_drafts_tenant ON social_drafts (tenant, updated_at DESC);

CREATE TABLE IF NOT EXISTS social_jobs (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  state TEXT NOT NULL,
  scheduled_at BIGINT,
  attempts INT NOT NULL DEFAULT 0,
  data JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_jobs_state ON social_jobs (state, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_social_jobs_tenant ON social_jobs (tenant, created_at DESC);

CREATE TABLE IF NOT EXISTS social_history (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  job_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  state TEXT NOT NULL,
  external_id TEXT,
  permalink TEXT,
  attempts INT NOT NULL DEFAULT 0,
  published_at BIGINT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_social_history_tenant ON social_history (tenant, published_at DESC);

-- Asset Service (media attached to posts). Added with the Webhook + Asset services.
CREATE TABLE IF NOT EXISTS social_assets (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  kind TEXT NOT NULL,
  uri TEXT NOT NULL,
  mime TEXT NOT NULL,
  alt_text TEXT,
  width INT,
  height INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_social_assets_tenant ON social_assets (tenant, created_at DESC);
