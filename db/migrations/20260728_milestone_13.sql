-- Milestone 13: Opportunity Detection & Market Intelligence.
-- Apply with `npm run db:migrate`. Additive — does not touch Milestone 12 tables.
-- Market Memory is the durable historical record: trends, competitor history, campaigns,
-- audiences, seasonality and past opportunities. Re-observation VERSIONS a row rather
-- than overwriting it, so history is never lost.

CREATE TABLE IF NOT EXISTS market_memory (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  performance REAL,
  observed_at BIGINT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_memory_tenant ON market_memory (tenant, kind, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_memory_key ON market_memory (tenant, key, observed_at);
