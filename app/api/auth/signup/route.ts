import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { hashPassword, createSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const limit = rateLimit(requestKey(req.headers), 6, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
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
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "weak_password", hint: "use at least 8 characters" }, { status: 400 });

  try {
    await ensureSchema(sql);
    const existing = (await sql`SELECT id FROM users WHERE email = ${email}`) as { id: string }[];
    if (existing.length) return NextResponse.json({ error: "email_taken" }, { status: 409 });
    const id = crypto.randomUUID();
    const hash = await hashPassword(password);
    await sql`INSERT INTO users (id, email, password_hash) VALUES (${id}, ${email}, ${hash})`;
    await createSession(id, email);
    return NextResponse.json({ user: { email } });
  } catch (e) {
    return NextResponse.json({ error: "server_error", detail: String(e).slice(0, 150) }, { status: 500 });
  }
}
