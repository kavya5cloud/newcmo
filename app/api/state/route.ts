import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const runtime = "nodejs";

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

type Sql = NonNullable<ReturnType<typeof db>>;

async function ensureTable(sql: Sql) {
  await sql`CREATE TABLE IF NOT EXISTS workspaces (
    wsid TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}

export async function GET(req: NextRequest) {
  const sql = db();
  if (!sql) return NextResponse.json({ enabled: false });
  const wsid = req.nextUrl.searchParams.get("wsid") || "";
  try {
    await ensureTable(sql);
    const rows = (await sql`SELECT state FROM workspaces WHERE wsid = ${wsid}`) as { state: unknown }[];
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
    if (!wsid) return NextResponse.json({ error: "no_wsid" }, { status: 400 });
    await ensureTable(sql);
    await sql`
      INSERT INTO workspaces (wsid, state, updated_at)
      VALUES (${wsid}, ${JSON.stringify(state)}, now())
      ON CONFLICT (wsid) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
    `;
    return NextResponse.json({ enabled: true, ok: true });
  } catch (e) {
    return NextResponse.json({ enabled: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}
