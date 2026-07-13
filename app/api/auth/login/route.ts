import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { verifyPassword, createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const sql = db();
  if (!sql) return NextResponse.json({ error: "no_database", hint: "set DATABASE_URL to enable accounts" }, { status: 503 });

  let email: string, password: string;
  try {
    const b = await req.json();
    email = String(b.email || "").trim().toLowerCase();
    password = String(b.password || "");
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    await ensureSchema(sql);
    const rows = (await sql`SELECT id, password_hash FROM users WHERE email = ${email}`) as { id: string; password_hash: string }[];
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }
    await createSession(user.id, email);
    return NextResponse.json({ user: { email } });
  } catch (e) {
    return NextResponse.json({ error: "server_error", detail: String(e).slice(0, 150) }, { status: 500 });
  }
}
