// Optimal publish windows per marketing channel, with timezone-aware scheduling.

export const PUBLISH_CHANNELS = ["linkedin", "x", "reddit", "hn", "articles"] as const;
export type PublishChannel = (typeof PUBLISH_CHANNELS)[number];

export const CHANNEL_LABELS: Record<PublishChannel, string> = {
  linkedin: "LinkedIn",
  x: "X",
  reddit: "Reddit",
  hn: "Hacker News",
  articles: "Blog",
};

type Window = { days: number[]; startHour: number; endHour: number };

const DEFAULT_WINDOWS: Record<PublishChannel, Window[]> = {
  linkedin: [
    { days: [2, 3, 4], startHour: 8, endHour: 10 },
    { days: [2, 3, 4], startHour: 12, endHour: 13 },
  ],
  x: [
    { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 11 },
    { days: [1, 2, 3, 4, 5], startHour: 17, endHour: 18 },
  ],
  reddit: [{ days: [0, 1, 2, 3, 4, 5, 6], startHour: 18, endHour: 21 }],
  hn: [{ days: [1, 2, 3, 4, 5], startHour: 8, endHour: 10 }],
  articles: [{ days: [2, 3], startHour: 9, endHour: 11 }],
};

export type NotificationPrefs = {
  enabled: boolean;
  timezone: string;
  channels: PublishChannel[];
  quietStart: number;
  quietEnd: number;
  gscSite?: string | null;
};

export const DEFAULT_PREFS: NotificationPrefs = {
  enabled: false,
  timezone: "UTC",
  channels: [...PUBLISH_CHANNELS],
  quietStart: 22,
  quietEnd: 8,
  gscSite: null,
};

function localParts(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: dayMap[weekday] ?? 1, hour };
}

function inQuietHours(hour: number, quietStart: number, quietEnd: number) {
  if (quietStart < quietEnd) return hour >= quietStart && hour < quietEnd;
  return hour >= quietStart || hour < quietEnd;
}

export function isInPublishWindow(
  channel: PublishChannel,
  tz: string,
  now = new Date(),
  peakHours?: number[]
): boolean {
  const { day, hour } = localParts(now, tz);
  if (peakHours?.length) {
    return peakHours.includes(hour);
  }
  const windows = DEFAULT_WINDOWS[channel];
  return windows.some((w) => w.days.includes(day) && hour >= w.startHour && hour < w.endHour);
}

export function minutesUntilWindow(
  channel: PublishChannel,
  tz: string,
  now = new Date(),
  peakHours?: number[]
): number | null {
  for (let m = 0; m < 24 * 60; m += 15) {
    const t = new Date(now.getTime() + m * 60_000);
    if (isInPublishWindow(channel, tz, t, peakHours)) return m;
  }
  return null;
}

export function activeChannelsNow(
  channels: PublishChannel[],
  tz: string,
  quietStart: number,
  quietEnd: number,
  now = new Date(),
  peakByChannel?: Partial<Record<PublishChannel, number[]>>
): PublishChannel[] {
  const { hour } = localParts(now, tz);
  if (inQuietHours(hour, quietStart, quietEnd)) return [];
  return channels.filter((ch) => isInPublishWindow(ch, tz, now, peakByChannel?.[ch]));
}

export function upcomingChannels(
  channels: PublishChannel[],
  tz: string,
  withinMinutes = 30,
  now = new Date(),
  peakByChannel?: Partial<Record<PublishChannel, number[]>>
): { channel: PublishChannel; minutes: number }[] {
  const out: { channel: PublishChannel; minutes: number }[] = [];
  for (const ch of channels) {
    const mins = minutesUntilWindow(ch, tz, now, peakByChannel?.[ch]);
    if (mins !== null && mins <= withinMinutes) out.push({ channel: ch, minutes: mins });
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

export function formatWindowLabel(channel: PublishChannel): string {
  const w = DEFAULT_WINDOWS[channel][0];
  const days = w.days.length >= 5 ? "weekdays" : w.days.length === 3 ? "Tue–Thu" : "daily";
  const h = (n: number) => {
    const ampm = n >= 12 ? "PM" : "AM";
    const h12 = n % 12 || 12;
    return `${h12}${ampm}`;
  };
  return `${CHANNEL_LABELS[channel]} · ${days} ${h(w.startHour)}–${h(w.endHour)}`;
}

/** Derive peak click hours (0-23) from GSC hour-of-day data. */
export function peakHoursFromGsc(hourClicks: { hour: number; clicks: number }[]): number[] {
  if (!hourClicks.length) return [];
  const sorted = [...hourClicks].sort((a, b) => b.clicks - a.clicks);
  const top = sorted.slice(0, 3).map((h) => h.hour);
  const neighbors = new Set(top);
  for (const h of top) {
    neighbors.add((h + 23) % 24);
    neighbors.add((h + 1) % 24);
  }
  return [...neighbors].sort((a, b) => a - b);
}
