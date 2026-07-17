import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { listApplications, setApplicationStatus, EA_STATUSES, type EaStatus } from "@/lib/early-access";

export const runtime = "nodejs";

// Admin-only: list applications and update their status. Gated by ADMIN_EMAILS allowlist.
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sql = db();
  if (!sql) return NextResponse.json({ error: "no_database" }, { status: 503 });
  try {
    const applications = await listApplications(sql);
    return NextResponse.json({ ok: true, applications });
  } catch (e) {
    return NextResponse.json({ error: "list_failed", detail: String(e).slice(0, 150) }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sql = db();
  if (!sql) return NextResponse.json({ error: "no_database" }, { status: 503 });

  let body: { id?: string; status?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const id = String(body.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "bad_id" }, { status: 400 });
  const status = String(body.status || "") as EaStatus;
  if (!EA_STATUSES.includes(status)) return NextResponse.json({ error: "bad_status" }, { status: 400 });

  try {
    const ok = await setApplicationStatus(sql, id, status, body.notes);
    if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "update_failed", detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
