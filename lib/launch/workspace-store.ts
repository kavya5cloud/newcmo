import { type Sql, RUNTIME_DDL } from "@/lib/db";
import { emptyState, type WorkspaceState } from "./workspace";

// Persistence for Launch Workspace execution state. Same repository pattern as the rest of
// the codebase: in-memory (default / tests / no database) + Neon (durable). The plan lives
// in `launches`; this table holds only what the founder changed on top of it.

export interface WorkspaceStateRepo {
  get(workspaceKey: string, launchId: string): Promise<WorkspaceState>;
  save(state: WorkspaceState): Promise<WorkspaceState>;
}

export class InMemoryWorkspaceStateRepo implements WorkspaceStateRepo {
  private rows = new Map<string, WorkspaceState>();
  private k(ws: string, id: string) { return `${ws}::${id}`; }

  async get(workspaceKey: string, launchId: string) {
    return this.rows.get(this.k(workspaceKey, launchId)) ?? emptyState(workspaceKey, launchId);
  }
  async save(state: WorkspaceState) {
    this.rows.set(this.k(state.workspaceKey, state.launchId), state);
    return state;
  }
}

let ready = false;
async function ensureTable(sql: Sql) {
  if (ready) return;
  if (!RUNTIME_DDL) { ready = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS launch_workspace_state (
    workspace_key TEXT NOT NULL, launch_id TEXT NOT NULL,
    state JSONB NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY (workspace_key, launch_id)
  )`;
  ready = true;
}

export class NeonWorkspaceStateRepo implements WorkspaceStateRepo {
  constructor(private sql: Sql) {}

  async get(workspaceKey: string, launchId: string): Promise<WorkspaceState> {
    await ensureTable(this.sql);
    const rows = (await this.sql`SELECT state FROM launch_workspace_state
      WHERE workspace_key = ${workspaceKey} AND launch_id = ${launchId}`) as { state: WorkspaceState }[];
    return rows[0]?.state ?? emptyState(workspaceKey, launchId);
  }

  async save(state: WorkspaceState): Promise<WorkspaceState> {
    await ensureTable(this.sql);
    await this.sql`INSERT INTO launch_workspace_state (workspace_key, launch_id, state, updated_at)
      VALUES (${state.workspaceKey}, ${state.launchId}, ${JSON.stringify(state)}, ${state.updatedAt})
      ON CONFLICT (workspace_key, launch_id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`;
    return state;
  }
}
