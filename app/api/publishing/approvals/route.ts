import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { ApprovalWorkflow, saveApproval, listApprovals } from "@/lib/publishing";
import { APPROVAL_ROLES, type ApprovalDecision, type ApprovalRole } from "@/lib/publishing/types";

export const runtime = "nodejs";

const DECISIONS: ApprovalDecision[] = ["approved", "rejected", "changes_requested"];

// Approval Workflow — record individual/bulk role-based approvals; every decision stores
// user, timestamp, comments and version. Publishing never bypasses approval.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  const sql = db();
  if (!sql) return NextResponse.json({ ok: true, approvals: [], enabled: false });
  const approvals = await listApprovals(sql, req.nextUrl.searchParams.get("assetKey") || undefined);
  return NextResponse.json({ ok: true, approvals, enabled: true });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 8, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const role = String(body.role || "") as ApprovalRole;
  const decision = String(body.decision || "approved") as ApprovalDecision;
  const user = String(body.user || session?.userId || "").trim();
  const assetKeys: string[] = Array.isArray(body.assetKeys)
    ? (body.assetKeys as string[])
    : body.assetKey ? [String(body.assetKey)] : [];

  if (!assetKeys.length || !(APPROVAL_ROLES as readonly string[]).includes(role) || !DECISIONS.includes(decision) || !user) {
    return NextResponse.json({ error: "missing_fields", hint: "assetKey(s) + valid role + decision + user" }, { status: 422 });
  }

  const workflow = new ApprovalWorkflow({ now: () => Date.now() });
  const records = assetKeys.map((k) =>
    workflow.decide({ assetKey: k, role, user, decision, comments: String(body.comments || ""), version: Number(body.version) || 1 })
  );

  const sql = db();
  if (sql) { try { for (const r of records) await saveApproval(sql, r); } catch { /* best-effort */ } }

  return NextResponse.json({ ok: true, records });
}
