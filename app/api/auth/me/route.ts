import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";

export const runtime = "nodejs";

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 30);
const DAY = 86_400_000;

export async function GET() {
  const session = await getSession();
  const sql = db();
  if (!session) return NextResponse.json({ user: null, accountsEnabled: !!sql });

  let createdAt: string | null = null;
  let trial: { endsAt: string; daysLeft: number; active: boolean } | null = null;

  if (sql) {
    try {
      await ensureSchema(sql);
      const rows = (await sql`SELECT created_at FROM users WHERE id = ${session.userId}`) as { created_at: string }[];
      if (rows[0]) {
        createdAt = new Date(rows[0].created_at).toISOString();
        const end = new Date(rows[0].created_at).getTime() + TRIAL_DAYS * DAY;
        trial = {
          endsAt: new Date(end).toISOString(),
          daysLeft: Math.max(0, Math.ceil((end - Date.now()) / DAY)),
          active: Date.now() < end,
        };
      }
    } catch {
      /* ignore — trial info is best-effort */
    }
  }

  return NextResponse.json({ user: { email: session.email }, accountsEnabled: !!sql, createdAt, trial });
}
