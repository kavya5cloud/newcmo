-- Milestone 15 — AI Marketing Team.
-- The task log is the transparency record: what each agent did, why, how confident it was
-- and how long it took. Stored whole (with the operator's pause/approval controls) rather
-- than derived, because "what did the Content agent do last Tuesday" must be answerable.
CREATE TABLE IF NOT EXISTS agent_team_state (
  tenant     TEXT NOT NULL,
  launch_id  TEXT NOT NULL,
  state      JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant, launch_id)
);
