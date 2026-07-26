-- Launch Workspace execution state. The plan itself lives in `launches`; this table holds
-- only what the founder changed on top of it (item statuses, automation, mission edits),
-- so a plan can always be recomputed without losing execution progress.
CREATE TABLE IF NOT EXISTS launch_workspace_state (
  workspace_key TEXT NOT NULL,
  launch_id     TEXT NOT NULL,
  state         JSONB NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (workspace_key, launch_id)
);
