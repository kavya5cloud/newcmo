-- Content creation: UGC packages (hooks, scripts, versions, approvals). Composed content is
-- not stored — it is deterministic from the prompt, and anything a founder decides to keep
-- becomes a draft in social_drafts, which already exists.
CREATE TABLE IF NOT EXISTS ugc_packages (
  id         TEXT NOT NULL,
  tenant     TEXT NOT NULL,
  data       JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant, id)
);
CREATE INDEX IF NOT EXISTS idx_ugc_tenant ON ugc_packages (tenant, updated_at DESC);
