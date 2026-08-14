import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, ensureSchema } from "@/lib/db";
import { bonusDaysFor } from "@/lib/referrals-store";
import { accessForUser } from "@/lib/billing/gate";

export const runtime = "nodejs";

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 30);
const DAY = 86_400_000;

// This route decides whether the browser shows the "your free month has ended" lock.
//
// It computed that from created_at alone and knew nothing about subscriptions, so a paying
// account was let through by /api/generate and locked out by the interface in front of it.
// Worst of both: the gate says yes, the screen says no, and the screen is what people see.
//
// `active` now comes from accessForUser — the same decision the gates make. The trial dates
// stay in the payload because the UI still shows "30d left", but they no longer decide
// anything.

export async function GET() {
  const session = await getSession();
  const sql = db();
  if (!session) return NextResponse.json({ user: null, accountsEnabled: !!sql });

  let createdAt: string | null = null;
  let trial: { endsAt: string; daysLeft: number; active: boolean; bonusDays: number } | null = null;

  // The one access decision, shared with every gate.
  const access = await accessForUser(session.userId);

  if (sql) {
    try {
      await ensureSchema(sql);
      const rows = (await sql`SELECT created_at FROM users WHERE id = ${session.userId}`) as { created_at: string }[];
      if (rows[0]) {
        createdAt = new Date(rows[0].created_at).toISOString();
        const bonus = await bonusDaysFor(session.userId).catch(() => 0);
        const trialEnd = new Date(rows[0].created_at).getTime() + (TRIAL_DAYS + bonus) * DAY;
        // Count down to whatever is actually keeping them in — a subscription period when
        // there is one, the trial otherwise. Showing "0d left" to a subscriber is the same
        // bug in a smaller font.
        const end = access.until ?? trialEnd;
        trial = {
          endsAt: new Date(end).toISOString(),
          daysLeft: Math.max(0, Math.ceil((end - Date.now()) / DAY)),
          active: access.allowed,
          bonusDays: bonus,
        };
      }
    } catch {
      /* ignore — trial info is best-effort */
    }
  }

  return NextResponse.json({
    user: { email: session.email },
    accountsEnabled: !!sql,
    createdAt,
    trial,
    // Why they are in, so the UI can say "subscription" rather than implying a trial.
    access: { allowed: access.allowed, reason: access.reason, until: access.until },
  });
}
