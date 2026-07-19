-- Milestone 8: Creative Intelligence Layer. Apply with `npm run db:migrate`.
-- Persistence for reusable characters, creative memory and per-asset lineage. The
-- engines themselves are pure/deterministic; these tables only store reusable + audit
-- state. Runtime ensure* guards mirror this for dev/test.

CREATE TABLE IF NOT EXISTS ci_characters (
  id TEXT PRIMARY KEY,
  workspace_key TEXT,
  name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ci_char_ws ON ci_characters (workspace_key, created_at DESC);

CREATE TABLE IF NOT EXISTS ci_creative_memory (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  performance REAL NOT NULL DEFAULT 0,
  version INT NOT NULL DEFAULT 1,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ci_mem_kind ON ci_creative_memory (kind, performance DESC);

CREATE TABLE IF NOT EXISTS ci_asset_lineage (
  asset_id TEXT PRIMARY KEY,
  spec_id TEXT NOT NULL,
  provider TEXT,
  model_version TEXT,
  cost REAL,
  latency_ms INT,
  approval TEXT,
  performance REAL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
