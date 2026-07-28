-- Automated publishing. The queue is stored per slot rather than as one blob: the cron
-- updates a handful of rows a minute, and a blob would make every write a whole-queue
-- rewrite and every concurrent run a last-writer-wins race.
CREATE TABLE IF NOT EXISTS automations (
  id         TEXT PRIMARY KEY,
  tenant     TEXT NOT NULL,
  data       JSONB NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automations_tenant ON automations (tenant);

CREATE TABLE IF NOT EXISTS automation_queue (
  id            TEXT PRIMARY KEY,
  tenant        TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  at            BIGINT NOT NULL,
  state         TEXT NOT NULL,
  data          JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_queue_due ON automation_queue (tenant, state, at);
