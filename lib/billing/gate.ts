import { db, ensureSchema } from "@/lib/db";
import { bonusDaysFor } from "@/lib/referrals-store";
import { accessFor, ACCESS_MESSAGE, type Access } from "./access";
import { subscriptionRepo } from "./store";

// The single question every gated route asks.
//
// Routes used to call isTrialActive() directly, which conflated "may this account use the
// product" with "is this account inside its first 30 days". Those are the same question only
// while nobody is paying — and the day someone does, a paying customer gets told their trial
// ended. This is the question; lib/billing/access.ts is the answer's logic, kept pure.

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 30);
const DAY = 86_400_000;

/** When this account's free trial ends, including referral bonus days. Null if unknown. */
async function trialEndsAt(userId: string): Promise<number | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensureSchema(sql);
    const rows = (await sql`SELECT created_at FROM users WHERE id = ${userId}`) as { created_at: string }[];
    if (!rows[0]) return null;
    // Bonus days stay derived from referral rows rather than written back, so the trial
    // length cannot drift from the rows that justify it.
    const bonus = await bonusDaysFor(userId).catch(() => 0);
    return new Date(rows[0].created_at).getTime() + (TRIAL_DAYS + bonus) * DAY;
  } catch {
    return null;
  }
}

/**
 * May this account use paid features, and why.
 *
 * Fails open on infrastructure trouble. If the database is unreachable we cannot prove
 * someone should be locked out, and locking out a paying customer because of our outage is
 * a worse failure than briefly serving someone who lapsed.
 */
export async function accessForUser(userId: string, now: number = Date.now()): Promise<Access> {
  try {
    const [ends, sub] = await Promise.all([
      trialEndsAt(userId),
      subscriptionRepo().get(userId).catch(() => null),
    ]);
    // No account row and no subscription means no database — an anonymous demo, not a lapse.
    if (ends == null && !sub) return { allowed: true, reason: "trial", until: null };
    return accessFor({ trialEndsAt: ends, subscription: sub }, now);
  } catch {
    return { allowed: true, reason: "trial", until: null };
  }
}

/** The sentence to show when access is refused. */
export function accessMessage(access: Access): string {
  return ACCESS_MESSAGE[access.reason];
}
