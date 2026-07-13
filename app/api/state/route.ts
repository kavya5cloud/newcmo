import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// The storage key is the logged-in user's id when authenticated (server-derived,
// so it can't be spoofed); otherwise the anonymous browser-supplied wsid.
async function keyFor(clientWsid: string | null): Promise<string | null> {
  const session = await getSession();
  if (session) return "user:" + session.userId;
  return clientWsid ? "anon:" + clientWsid : null;
}

export async function GET(req: NextRequest) {
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false });
  const key = await keyFor(req.nextUrl.searchParams.get("wsid"));
  if (!key) return NextResponse.json({ enabled: true, state: null });
  try {
    await ensureSchema(sql);
    const rows = (await sql`SELECT state FROM workspaces WHERE wsid = ${key}`) as { state: unknown }[];
    return NextResponse.json({ enabled: true, state: rows[0]?.state ?? null });
  } catch (e) {
    return NextResponse.json({ enabled: false, error: String(e).slice(0, 200) });
  }
}

export async function POST(req: NextRequest) {
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false });
  try {
    const { wsid, state } = await req.json();
    const key = await keyFor(wsid);
    if (!key) return NextResponse.json({ error: "no_key" }, { status: 400 });
    await ensureSchema(sql);
    await sql`
      INSERT INTO workspaces (wsid, state, updated_at)
      VALUES (${key}, ${JSON.stringify(state)}, now())
      ON CONFLICT (wsid) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
    `;
    return NextResponse.json({ enabled: true, ok: true });
  } catch (e) {
    return NextResponse.json({ enabled: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}
