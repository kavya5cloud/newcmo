import type { PublishJob } from "./types";

// Scheduler — timezone-aware scheduling + backoff math. It contains ZERO platform-specific
// logic: it only decides WHEN a job should run. Workers (via adapters) decide HOW.

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

/**
 * Convert a wall-clock time in an IANA timezone to a UTC epoch (ms), DST-correct.
 * e.g. { 2026, 8, 1, 9, 0 } in "America/New_York" → the right UTC instant.
 */
export function zonedTimeToEpoch(wall: WallClock, timezone: string): number {
  const asUTC = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // Offset = how far the target tz is from UTC at that instant.
  const tzStr = new Date(asUTC).toLocaleString("en-US", { timeZone: timezone });
  const utcStr = new Date(asUTC).toLocaleString("en-US", { timeZone: "UTC" });
  const offset = new Date(utcStr).getTime() - new Date(tzStr).getTime();
  return asUTC + offset;
}

/** Parse an ISO-like "YYYY-MM-DDTHH:mm" (local wall time) in a timezone to a UTC epoch. */
export function parseSchedule(local: string, timezone: string): number | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  return zonedTimeToEpoch({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] }, timezone);
}

/** Render a UTC epoch as the local wall time in a timezone (for the calendar/UI). */
export function formatInZone(epoch: number, timezone: string): string {
  return new Date(epoch).toLocaleString("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
}

/** A job is due when it's scheduled (or now) and its backoff window has elapsed. */
export function isDue(job: PublishJob, now: number): boolean {
  if (job.state !== "queued" && job.state !== "scheduled") return false;
  if (job.nextAttemptAt != null && now < job.nextAttemptAt) return false;
  return job.scheduledAt == null || now >= job.scheduledAt;
}

const BASE_BACKOFF_MS = 30_000;   // 30s
const MAX_BACKOFF_MS = 60 * 60_000; // 1h

/** Exponential backoff for the Nth attempt (1-based). */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1));
}
