import { db, ensureSchema } from "@/lib/db";

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 30);
const DAY = 86_400_000;

// Server-side trial check. Returns true when the account may still use paid features.
// No database, no account, or unknown user → not gated (anonymous demo stays open).
export async function isTrialActive(userId: string): Promise<boolean> {
  const sql = db();
  if (!sql) return true;
  try {
    await ensureSchema(sql);
    const rows = (await sql`SELECT created_at FROM users WHERE id = ${userId}`) as { created_at: string }[];
    if (!rows[0]) return true;
    const end = new Date(rows[0].created_at).getTime() + TRIAL_DAYS * DAY;
    return Date.now() < end;
  } catch {
    return true;
  }
}
