import type { Cadence, Weekday } from "./types";

// Turning a cadence into concrete times.
//
// Deterministic and pure: same cadence + same window = same slots, every time. That is
// what makes an automation auditable — a founder can see exactly when the next twelve
// posts go out, and re-running the expansion never shuffles them.
//
// Slots are UTC epochs. Timezone conversion belongs to the M12 scheduler, which already
// owns it; duplicating that here is how two parts of a product start disagreeing about
// what "Friday" means.

const DAY_MS = 86_400_000;

/** Default posting hour (UTC) when the cadence doesn't pin one. Mid-morning, not 00:00. */
const DEFAULT_HOUR = 9;

function atHour(dayStart: number, hour: number): number {
  return dayStart + hour * 3_600_000;
}

/** Midnight UTC on the day containing `t`. */
export function startOfDay(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS;
}

function weekdayOf(t: number): Weekday {
  return new Date(t).getUTCDay() as Weekday;
}

/**
 * Spread `count` posts across a period without clustering them.
 *
 * Three posts a week on consecutive days is not a weekly cadence, it's a burst — so
 * evenly-spaced offsets are chosen across the available days instead.
 */
function spread(count: number, span: number): number[] {
  if (count <= 1) return [0];
  const step = span / count;
  return Array.from({ length: count }, (_, i) => Math.round(i * step));
}

export type ExpandOptions = {
  /** Window start (inclusive). */
  from: number;
  /** Window end (exclusive). */
  to: number;
  /** Hour of day, UTC. */
  hour?: number;
  /** Hard cap, so a pathological cadence can't generate unbounded slots. */
  limit?: number;
};

/**
 * Expand a cadence into the times it fires inside a window.
 *
 * `custom` cadences carrying an RRULE are not expanded here — see `parseSimpleRrule`,
 * which handles the subset we can honour honestly, and returns null for the rest rather
 * than guessing at semantics we don't implement.
 */
export function expand(cadence: Cadence, opts: ExpandOptions): number[] {
  const hour = opts.hour ?? DEFAULT_HOUR;
  const limit = opts.limit ?? 200;
  const out: number[] = [];
  const from = opts.from;
  const to = opts.to;
  if (to <= from) return out;

  const push = (t: number) => {
    if (t >= from && t < to && out.length < limit) out.push(t);
  };

  switch (cadence.kind) {
    case "daily": {
      const perDay = Math.max(1, cadence.count);
      for (let day = startOfDay(from); day < to; day += DAY_MS) {
        // Several posts in one day are spaced across the working hours rather than
        // fired together — a queue that posts three times at 09:00 reads as a bot.
        for (let i = 0; i < perDay; i++) {
          push(atHour(day, hour + Math.round((i * 8) / perDay)));
        }
      }
      break;
    }

    case "weekly": {
      const days: Weekday[] = cadence.days.length
        ? cadence.days
        : (spread(Math.max(1, cadence.count), 7).map((o) => ((1 + o) % 7) as Weekday));
      // When the user named fewer days than posts, wrap: 3 posts on [Tue] → Tue of
      // three consecutive weeks would be wrong, so post multiple times that day.
      const perDay = cadence.days.length
        ? Math.max(1, Math.ceil(cadence.count / cadence.days.length))
        : 1;
      for (let day = startOfDay(from); day < to; day += DAY_MS) {
        if (!days.includes(weekdayOf(day))) continue;
        for (let i = 0; i < perDay; i++) push(atHour(day, hour + i * 4));
      }
      break;
    }

    case "monthly": {
      const dom = Math.min(28, Math.max(1, cadence.dayOfMonth ?? 1));
      const cursor = new Date(from);
      cursor.setUTCDate(1);
      cursor.setUTCHours(0, 0, 0, 0);
      for (let m = 0; m < 24 && out.length < limit; m++) {
        const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + m, dom));
        if (d.getTime() >= to) break;
        for (let i = 0; i < Math.max(1, cadence.count); i++) {
          push(atHour(startOfDay(d.getTime()), hour + i * 3));
        }
      }
      break;
    }

    case "custom": {
      const parsed = cadence.rrule ? parseSimpleRrule(cadence.rrule) : null;
      if (!parsed) return out;      // Unsupported rule: no slots, and the caller says so.
      return expand({ ...parsed, count: parsed.count || cadence.count }, opts);
    }
  }

  return out.sort((a, b) => a - b);
}

const RRULE_DAY: Record<string, Weekday> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/**
 * Parse the RRULE subset we genuinely support: FREQ, INTERVAL=1, BYDAY, BYMONTHDAY, COUNT.
 *
 * Returns null for anything else. A partially-understood recurrence rule is worse than an
 * unsupported one — it publishes on days nobody asked for.
 */
export function parseSimpleRrule(rrule: string): Cadence | null {
  const body = rrule.replace(/^RRULE:/i, "").trim();
  if (!body) return null;
  const parts = Object.fromEntries(
    body.split(";").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.toUpperCase() ?? "", v ?? ""];
    }),
  );

  const interval = Number(parts.INTERVAL ?? "1");
  if (Number.isFinite(interval) && interval !== 1) return null;   // not implemented

  const count = Math.max(1, Number(parts.COUNT ?? "1") || 1);
  const byDay = (parts.BYDAY ?? "").split(",").map((d) => RRULE_DAY[d.trim().toUpperCase()])
    .filter((d): d is Weekday => d !== undefined);

  switch ((parts.FREQ ?? "").toUpperCase()) {
    case "DAILY": return { kind: "daily", count, days: [] };
    case "WEEKLY": return { kind: "weekly", count: byDay.length || count, days: byDay };
    case "MONTHLY": {
      const dom = Number(parts.BYMONTHDAY ?? "1");
      return { kind: "monthly", count, days: [], dayOfMonth: Number.isFinite(dom) ? dom : 1 };
    }
    default: return null;
  }
}

/** A sentence describing the cadence, rebuilt from the parsed rule so it can't drift. */
export function describe(cadence: Cadence): string {
  const n = Math.max(1, cadence.count);
  const posts = `${n} post${n === 1 ? "" : "s"}`;
  switch (cadence.kind) {
    case "daily": return `${posts} a day`;
    case "weekly": {
      if (cadence.days.length) {
        const names = cadence.days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]);
        return `${posts} a week, on ${names.join(", ")}`;
      }
      return `${posts} a week`;
    }
    case "monthly": return `${posts} a month, on day ${cadence.dayOfMonth ?? 1}`;
    case "custom": return cadence.rrule ? `custom rule (${cadence.rrule})` : "custom rule";
  }
}
