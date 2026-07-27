-- Milestone 14 — AI Campaign Execution Engine.
-- Execution state is the run; the activity table is the append-only record of what happened;
-- dismissals and adaptation decisions are the human decisions layered on top. Notifications
-- and proposals themselves are derived on read, so only the decisions are stored.

CREATE TABLE IF NOT EXISTS execution_state (
  tenant     TEXT NOT NULL,
  launch_id  TEXT NOT NULL,
  state      JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant, launch_id)
);

CREATE TABLE IF NOT EXISTS execution_activity (
  id          TEXT PRIMARY KEY,
  tenant      TEXT NOT NULL,
  launch_id   TEXT NOT NULL,
  campaign_id TEXT,
  kind        TEXT NOT NULL,
  message     TEXT NOT NULL,
  at          BIGINT NOT NULL,
  meta        JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_activity_feed ON execution_activity (tenant, launch_id, at DESC);

CREATE TABLE IF NOT EXISTS execution_notifications (
  tenant          TEXT NOT NULL,
  launch_id       TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  dismissed_at    BIGINT NOT NULL,
  PRIMARY KEY (tenant, launch_id, notification_id)
);

CREATE TABLE IF NOT EXISTS execution_adaptations (
  tenant      TEXT NOT NULL,
  launch_id   TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  proposal    JSONB NOT NULL,
  decided_at  BIGINT,
  PRIMARY KEY (tenant, launch_id, proposal_id)
);
