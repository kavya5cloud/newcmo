// Trial countdown, as the dashboard shows it.
//
// The server owns the real answer (lib/trial.ts). This only shapes it for display.


export const DAY_MS = 86_400_000;

export function trialSnapshot(trial: { active: boolean; daysLeft: number; endsAt: string } | null, nowMs: number) {
  if (!trial) return null;
  const endMs = Date.parse(trial.endsAt);
  if (!Number.isFinite(endMs)) return trial;
  const liveDaysLeft = Math.max(0, Math.ceil((endMs - nowMs) / DAY_MS));
  return {
    ...trial,
    daysLeft: liveDaysLeft,
    active: nowMs < endMs,
  };
}

/**
 * No fake numbers, ever: if a channel summary contains a digit (AI models love inventing
 * "36 opportunities ready"), replace it with the real item count. Summaries without
 * numbers are kept — qualitative notes are fine, invented statistics are not.
 */
