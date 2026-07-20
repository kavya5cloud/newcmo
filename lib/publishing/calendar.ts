import { ASSET_KIND_META } from "@/lib/creative/taxonomy";
import type { LaunchPlan } from "@/lib/launch/types";
import { platformFor } from "./providers";
import type { CalendarBucket, CalendarEvent, CalendarView } from "./types";

// Marketing Calendar — turns a launch's publishing schedule into calendar events and
// groups them into views (day/week/month/campaign/mission/platform). Reschedule /
// duplicate / cancel are pure array transforms the API + dashboard drive. Everything is
// derived from the plan (Asset Graph source of truth), never invented.

/** Build calendar events from a launch plan's publishing schedule. */
export function buildCalendar(plan: LaunchPlan): CalendarEvent[] {
  // Label + campaign lookup from the timeline (assetKey → item).
  const meta = new Map<string, { campaignId: string; label: string }>();
  for (const w of plan.weeks) for (const it of w.items) meta.set(it.assetKey, { campaignId: it.campaignId, label: it.label });

  return plan.publishingSchedule.map((s) => {
    const m = meta.get(s.assetKey);
    return {
      assetKey: s.assetKey,
      label: m?.label ?? ASSET_KIND_META[s.kind]?.label ?? s.kind,
      kind: s.kind,
      platform: platformFor(s.kind, s.channel),
      channel: s.channel,
      campaignId: m?.campaignId ?? (s.assetKey.slice(0, s.assetKey.lastIndexOf(":")) || ""),
      dayOffset: s.dayOffset,
      week: s.week,
      stage: s.stage,
    };
  });
}

/** Group calendar events into buckets for a given view. Deterministic ordering. */
export function calendarView(events: CalendarEvent[], view: CalendarView): CalendarBucket[] {
  const buckets = new Map<string, CalendarEvent[]>();
  const labelOf = (e: CalendarEvent): { key: string; label: string } => {
    switch (view) {
      case "day": return { key: `d${e.dayOffset}`, label: `Day ${e.dayOffset}` };
      case "week": return { key: `w${e.week}`, label: `Week ${e.week}` };
      case "month": { const mo = Math.floor(e.dayOffset / 30) + 1; return { key: `m${mo}`, label: `Month ${mo}` }; }
      case "campaign": return { key: e.campaignId, label: e.campaignId };
      case "platform": return { key: e.platform, label: e.platform };
      case "mission": return { key: "mission", label: "Mission" };
    }
  };
  const labels = new Map<string, string>();
  for (const e of [...events].sort((a, b) => a.dayOffset - b.dayOffset || a.assetKey.localeCompare(b.assetKey))) {
    const { key, label } = labelOf(e);
    labels.set(key, label);
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(e);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([key, evs]) => ({ key, label: labels.get(key)!, events: evs }));
}

/** Reschedule an event to a new day offset (drag-and-drop). Returns a new array. */
export function reschedule(events: CalendarEvent[], assetKey: string, dayOffset: number): CalendarEvent[] {
  return events.map((e) => (e.assetKey === assetKey ? { ...e, dayOffset, week: Math.floor(dayOffset / 7) + 1 } : e));
}

/** Duplicate an event (a variant scheduled one day later). Returns a new array. */
export function duplicate(events: CalendarEvent[], assetKey: string): CalendarEvent[] {
  const src = events.find((e) => e.assetKey === assetKey);
  if (!src) return events;
  const copy: CalendarEvent = { ...src, assetKey: `${src.assetKey}#copy`, dayOffset: src.dayOffset + 1 };
  return [...events, copy];
}

/** Cancel (remove) an event. Returns a new array. */
export function cancel(events: CalendarEvent[], assetKey: string): CalendarEvent[] {
  return events.filter((e) => e.assetKey !== assetKey);
}
