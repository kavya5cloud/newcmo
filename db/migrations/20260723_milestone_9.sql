-- Milestone 9: Publishing & Growth Execution Layer. Apply with `npm run db:migrate`.
-- Durable state for approvals and publishing history. The engines (lifecycle, router,
-- calendar, packages) are pure/deterministic; only approval + history state is stored.
-- Runtime ensure* guards mirror this for dev/test.

CREATE TABLE IF NOT EXISTS pub_approvals (
  id TEXT PRIMARY KEY,
  asset_key TEXT NOT NULL,
  role TEXT NOT NULL,
  user_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  comments TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pub_approvals_asset ON pub_approvals (asset_key, created_at);

CREATE TABLE IF NOT EXISTS pub_history (
  id TEXT PRIMARY KEY,
  asset_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  provider TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  at BIGINT NOT NULL,
  retries INT NOT NULL DEFAULT 0,
  failures INT NOT NULL DEFAULT 0,
  rolled_back BOOLEAN NOT NULL DEFAULT false,
  published_url TEXT,
  preview_url TEXT,
  status TEXT NOT NULL,
  metrics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pub_history_asset ON pub_history (asset_key, at);
