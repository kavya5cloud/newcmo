import { type Sql, RUNTIME_DDL } from "@/lib/db";
import { emptyTeamState, type TeamState } from "./types";

// Persistence for the AI Team. The task log is the transparency record, so it is stored
// whole with the controls rather than derived — a founder asking "what did the Content
// agent do last Tuesday" must get an answer, not a recomputation.

export interface TeamStateRepo {
  get(tenant: string, launchId: string): Promise<TeamState>;
  save(state: TeamState): Promise<TeamState>;
}

export class InMemoryTeamStateRepo implements TeamStateRepo {
  private m = new Map<string, TeamState>();
  private k(t: string, l: string) { return `${t}::${l}`; }
  async get(tenant: string, launchId: string) { return this.m.get(this.k(tenant, launchId)) ?? emptyTeamState(tenant, launchId); }
  async save(state: TeamState) { this.m.set(this.k(state.tenant, state.launchId), state); return state; }
}

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS agent_team_state (
    tenant TEXT NOT NULL, launch_id TEXT NOT NULL, state JSONB NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY (tenant, launch_id) )`;
  ready = true;
}

export class NeonTeamStateRepo implements TeamStateRepo {
  constructor(private sql: Sql) {}

  async get(tenant: string, launchId: string): Promise<TeamState> {
    await ensureTable(this.sql);
    const rows = await this.sql`SELECT state FROM agent_team_state
      WHERE tenant = ${tenant} AND launch_id = ${launchId}` as { state: TeamState }[];
    return rows[0]?.state ?? emptyTeamState(tenant, launchId);
  }

  async save(state: TeamState): Promise<TeamState> {
    await ensureTable(this.sql);
    // The task log grows for the life of a launch; cap what is persisted so one long-running
    // launch can't grow a row without bound. The most recent work is what the panel shows.
    const trimmed: TeamState = state.tasks.length > 500
      ? { ...state, tasks: state.tasks.slice(-500) }
      : state;
    await this.sql`INSERT INTO agent_team_state (tenant, launch_id, state, updated_at)
      VALUES (${trimmed.tenant}, ${trimmed.launchId}, ${JSON.stringify(trimmed)}, ${trimmed.updatedAt})
      ON CONFLICT (tenant, launch_id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`;
    return trimmed;
  }
}
