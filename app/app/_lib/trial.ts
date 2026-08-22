// Trial countdown, as the dashboard shows it.
//
// The server owns the real answer (lib/trial.ts). This only shapes it for display.


export const DAY_MS = 86_400_000;

/**
 * The countdown ticks in the browser. The verdict does not.
 *
 * This used to recompute `active` as `nowMs < endMs`, which quietly replaced the server's
 * answer with a date comparison — and the server's answer is the only one that knows about
 * subscriptions, the grace period after a failed payment, and a cancelled plan that is paid
 * through to a date. /api/auth/me already sets `active` from accessForUser, the same
 * decision every gated route makes.
 *
 * The bad case is not hypothetical. accessFor returns `until: currentPeriodEnd` for an
 * active subscription, and that column is nullable — one webhook without a period end and
 * `endsAt` falls back to the local trial date, which for any customer past their first
 * month is in the past. The API would keep serving them and the screen would show "Your
 * free month has ended" over the top of it.
 *
 * That exact class of bug — the gate says yes, the screen says no, and the screen is what
 * people see — is what the comment in /api/auth/me describes fixing on the server. It came
 * straight back here.
 *
 * So: recompute the number, never the verdict.
 */
export function trialSnapshot(trial: { active: boolean; daysLeft: number; endsAt: string } | null, nowMs: number) {
  if (!trial) return null;
  const endMs = Date.parse(trial.endsAt);
  if (!Number.isFinite(endMs)) return trial;
  return {
    ...trial,
    daysLeft: Math.max(0, Math.ceil((endMs - nowMs) / DAY_MS)),
  };
}

/**
 * No fake numbers, ever: if a channel summary contains a digit (AI models love inventing
 * "36 opportunities ready"), replace it with the real item count. Summaries without
 * numbers are kept — qualitative notes are fine, invented statistics are not.
 */
