import { db, ensureSchema } from "@/lib/db";
import { canCredit, codeForUser, progressFor, type ReferralProgress } from "@/lib/referrals";

// Reading and writing referrals. The reward maths lives in lib/referrals.ts and stays pure;
// this file only talks to the database.

/**
 * Who owns a code.
 *
 * Codes are derived from the user id, so there is no lookup table — but that means finding
 * the owner requires checking candidates. Scanning every user would not survive growth, so
 * the code is recomputed per row over a bounded set. In practice this runs once, at signup.
 *
 * If the user table ever gets large enough for this to matter, the fix is a stored
 * referral_code column with a unique index; the rest of the system would not change.
 */
export async function userIdForCode(code: string): Promise<string | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensureSchema(sql);
    const rows = (await sql`SELECT id FROM users`) as { id: string }[];
    for (const r of rows) if (codeForUser(r.id) === code) return r.id;
    return null;
  } catch {
    return null;
  }
}

/** Whether this account has already been credited to someone. */
export async function alreadyCredited(userId: string): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await ensureSchema(sql);
    const rows = (await sql`SELECT 1 FROM referrals WHERE referred_user_id = ${userId}`) as unknown[];
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Credit a signup to whoever referred them.
 *
 * Never throws and never blocks the signup it is part of. Someone creating an account must
 * get their account even if the referral cannot be recorded — losing a referral credit is
 * an annoyance, losing a signup is not recoverable.
 */
export async function creditReferral(code: string, newUserId: string): Promise<{ credited: boolean; reason?: string }> {
  const sql = db();
  if (!sql) return { credited: false, reason: "no_database" };

  try {
    await ensureSchema(sql);
    const referrerId = await userIdForCode(code);
    const already = await alreadyCredited(newUserId);

    const check = canCredit({ referrerId, newUserId, alreadyCredited: already });
    if (!check.ok) return { credited: false, reason: check.reason };

    // ON CONFLICT DO NOTHING makes the write itself idempotent, so two concurrent signups
    // with the same id cannot both insert.
    await sql`INSERT INTO referrals (referred_user_id, referrer_id, code)
      VALUES (${newUserId}, ${referrerId}, ${code})
      ON CONFLICT (referred_user_id) DO NOTHING`;

    console.info(JSON.stringify({ event: "referral_credited", referrer: referrerId, code }));
    return { credited: true };
  } catch (e) {
    console.info(JSON.stringify({ event: "referral_failed", detail: String(e).slice(0, 120) }));
    return { credited: false, reason: "error" };
  }
}

/** How many accounts this user has brought in, and what that has earned. */
export async function progressForUser(userId: string): Promise<ReferralProgress> {
  const sql = db();
  if (!sql) return progressFor(0);
  try {
    await ensureSchema(sql);
    const rows = (await sql`SELECT COUNT(*)::int AS n FROM referrals WHERE referrer_id = ${userId}`) as { n: number }[];
    return progressFor(rows[0]?.n ?? 0);
  } catch {
    return progressFor(0);
  }
}

/** Extra trial days earned. Read straight from the rows, never stored. */
export async function bonusDaysFor(userId: string): Promise<number> {
  return (await progressForUser(userId)).bonusDays;
}
