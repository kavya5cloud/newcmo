import { type Sql, RUNTIME_DDL } from "@/lib/db";
import {
  APPROVAL_ROLES, type ApprovalDecision, type ApprovalRecord, type ApprovalRole,
} from "./types";

// Approval Workflow (Part 6) — individual, bulk and role-based approvals. Every decision
// is an immutable record (user, timestamp, comments, version). Publishing must never
// bypass approval; the Publishing Engine's gate consults this workflow.

function idFor(assetKey: string, role: string, seq: number): string {
  return `apr_${role}_${assetKey}_${seq}`;
}

export class ApprovalWorkflow {
  private records: ApprovalRecord[] = [];
  private now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => 0);
  }

  /** Record a single approval decision (append-only). */
  decide(input: {
    assetKey: string; role: ApprovalRole; user: string;
    decision: ApprovalDecision; comments?: string; version?: number;
  }): ApprovalRecord {
    const rec: ApprovalRecord = {
      id: idFor(input.assetKey, input.role, this.records.length),
      assetKey: input.assetKey, role: input.role, user: input.user,
      decision: input.decision, comments: input.comments ?? "",
      version: input.version ?? 1, at: this.now(),
    };
    this.records.push(rec);
    return rec;
  }

  approve(assetKey: string, role: ApprovalRole, user: string, comments = "", version = 1): ApprovalRecord {
    return this.decide({ assetKey, role, user, decision: "approved", comments, version });
  }

  /** Bulk approval: one role/user approves many assets at once. */
  bulkApprove(assetKeys: string[], role: ApprovalRole, user: string, comments = ""): ApprovalRecord[] {
    return assetKeys.map((k) => this.approve(k, role, user, comments));
  }

  /** The latest decision for an asset (optionally scoped to a role). */
  latest(assetKey: string, role?: ApprovalRole): ApprovalRecord | null {
    const rs = this.records.filter((r) => r.assetKey === assetKey && (!role || r.role === role));
    return rs.length ? rs[rs.length - 1] : null;
  }

  history(assetKey: string): ApprovalRecord[] {
    return this.records.filter((r) => r.assetKey === assetKey);
  }

  /** Role-based gate: is the asset approved by every required role (default: all three)? */
  isApproved(assetKey: string, requiredRoles: ApprovalRole[] = [...APPROVAL_ROLES]): boolean {
    return requiredRoles.every((role) => this.latest(assetKey, role)?.decision === "approved");
  }

  /** Assets currently awaiting a decision from a given role (for the approval queue). */
  pendingFor(assetKeys: string[], role: ApprovalRole): string[] {
    return assetKeys.filter((k) => this.latest(k, role)?.decision !== "approved");
  }

  all(): ApprovalRecord[] { return [...this.records]; }
}

// ---- Persistence (repository pattern) ----

let approvalsReady = false;
export async function ensureApprovalsTable(sql: Sql) {
  if (approvalsReady) return;
  if (!RUNTIME_DDL) { approvalsReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS pub_approvals (
    id TEXT PRIMARY KEY,
    asset_key TEXT NOT NULL,
    role TEXT NOT NULL,
    user_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    comments TEXT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pub_approvals_asset ON pub_approvals (asset_key, created_at)`;
  approvalsReady = true;
}

export async function saveApproval(sql: Sql, rec: ApprovalRecord): Promise<void> {
  await ensureApprovalsTable(sql);
  await sql`INSERT INTO pub_approvals (id, asset_key, role, user_id, decision, comments, version)
    VALUES (${rec.id}, ${rec.assetKey}, ${rec.role}, ${rec.user}, ${rec.decision}, ${rec.comments}, ${rec.version})
    ON CONFLICT (id) DO NOTHING`;
}

export async function listApprovals(sql: Sql, assetKey?: string): Promise<ApprovalRecord[]> {
  await ensureApprovalsTable(sql);
  const rows = assetKey
    ? (await sql`SELECT * FROM pub_approvals WHERE asset_key = ${assetKey} ORDER BY created_at`) as Record<string, unknown>[]
    : (await sql`SELECT * FROM pub_approvals ORDER BY created_at DESC LIMIT 500`) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id), assetKey: String(r.asset_key), role: r.role as ApprovalRole, user: String(r.user_id),
    decision: r.decision as ApprovalDecision, comments: String(r.comments ?? ""), version: Number(r.version),
    at: new Date(String(r.created_at)).getTime(),
  }));
}
