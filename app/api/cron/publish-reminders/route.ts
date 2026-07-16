import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { getAccessToken, queryAnalytics, isoDaysAgo, listSites } from "@/lib/google";
import { ensureGoogleTable } from "@/lib/google";
import {
  initWebPush,
  sendToUser,
  getPrefs,
  wasReminderSentToday,
  countRemindersToday,
  recordReminder,
  ensurePushTables,
  getSubscriptions,
} from "@/lib/push";
import {
  PUBLISH_CHANNELS,
  CHANNEL_LABELS,
  upcomingChannels,
  activeChannelsNow,
  peakHoursFromGsc,
  type PublishChannel,
  type NotificationPrefs,
} from "@/lib/publish-times";
import { matchGscSite } from "@/lib/gsc-match";
import { sweepExpiredCache } from "@/lib/ai-cache";

export const runtime = "nodejs";
export const maxDuration = 60;

type Draft = { id: string; title: string; channel: string; approved: boolean; published?: boolean };

const MAX_DAILY = 2;

function authCron(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV === "development";
  return req.headers.get("authorization") === "Bearer " + secret;
}

async function peakByChannel(
  token: string,
  site: string,
  channels: PublishChannel[]
): Promise<Partial<Record<PublishChannel, number[]>>> {
  const end = isoDaysAgo(2);
  const start = isoDaysAgo(30);
  const byHour = await queryAnalytics(token, site, start, end, ["hour"]);
  const peaks = peakHoursFromGsc(byHour.map((r) => ({ hour: Number(r.keys?.[0] || 0), clicks: r.clicks })));
  if (!peaks.length) return {};
  const out: Partial<Record<PublishChannel, number[]>> = {};
  for (const ch of channels) out[ch] = peaks;
  return out;
}

function approvedDraftsByChannel(drafts: Draft[], channels: PublishChannel[]): Map<PublishChannel, Draft[]> {
  const map = new Map<PublishChannel, Draft[]>();
  for (const ch of channels) {
    const list = drafts.filter((d) => d.channel === ch && d.approved && !d.published);
    if (list.length) map.set(ch, list);
  }
  return map;
}

export async function GET(req: NextRequest) {
  if (!authCron(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sql = db();
  if (!sql || !initWebPush()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  await ensureSchema(sql);
  await ensurePushTables(sql);
  await ensureGoogleTable(sql);

  // Deliberate periodic cleanup: drop expired analysis/scrape cache rows so the tables
  // don't grow unbounded (in addition to the opportunistic sweep on cache writes).
  await sweepExpiredCache(sql);

  const users = (await sql`SELECT id FROM users`) as { id: string }[];
  let sent = 0;

  for (const { id: userId } of users) {
    const subs = await getSubscriptions(sql, userId);
    if (!subs.length) continue;

    const prefs = await getPrefs(sql, userId);
    if (!prefs.enabled) continue;

    const todayCount = await countRemindersToday(sql, userId);
    if (todayCount >= MAX_DAILY) continue;

    const channels = prefs.channels.filter((c) => PUBLISH_CHANNELS.includes(c as PublishChannel)) as PublishChannel[];
    if (!channels.length) continue;

    const wsRows = (await sql`SELECT state FROM workspaces WHERE wsid = ${"user:" + userId}`) as { state: { drafts?: Draft[]; url?: string } }[];
    const state = wsRows[0]?.state || {};
    const drafts = state.drafts || [];

    let peakMap: Partial<Record<PublishChannel, number[]>> = {};
    const token = await getAccessToken(sql, userId);
    if (token) {
      const sites = await listSites(token);
      const site = prefs.gscSite || matchGscSite(sites, state.url || "");
      if (site) peakMap = await peakByChannel(token, site, channels);
    }

    const active = activeChannelsNow(channels, prefs.timezone, prefs.quietStart, prefs.quietEnd, new Date(), peakMap);
    const upcoming = upcomingChannels(channels, prefs.timezone, 15, new Date(), peakMap);
    const draftMap = approvedDraftsByChannel(drafts, channels);

    const toNotify: PublishChannel[] = [];
    for (const ch of active) {
      if (draftMap.has(ch) || drafts.some((d) => d.channel === ch && !d.published)) toNotify.push(ch);
    }
    for (const u of upcoming) {
      if (!toNotify.includes(u.channel) && draftMap.has(u.channel)) toNotify.push(u.channel);
    }

    if (!toNotify.length) {
      const feedOnly = active.filter((ch) => !draftMap.has(ch));
      if (feedOnly.length && todayCount < MAX_DAILY) {
        const key = `window:${feedOnly.join(",")}:${new Date().toISOString().slice(0, 10)}`;
        if (!(await wasReminderSentToday(sql, userId, key))) {
          const labels = feedOnly.map((c) => CHANNEL_LABELS[c]).join(" + ");
          const n = await sendToUser(sql, userId, {
            title: `Good time to post on ${labels}`,
            body: "Peak engagement window is open. Check your Agents feed for ready items.",
            url: "/app?tab=agents",
            tag: "publish-window",
          });
          if (n) { await recordReminder(sql, userId, key); sent += n; }
        }
      }
      continue;
    }

    const batch = toNotify.slice(0, 2);
    const key = `drafts:${batch.join(",")}:${new Date().toISOString().slice(0, 10)}:${Math.floor(Date.now() / (4 * 3600_000))}`;
    if (await wasReminderSentToday(sql, userId, key)) continue;
    if (todayCount + 1 > MAX_DAILY) continue;

    const labels = batch.map((c) => CHANNEL_LABELS[c]).join(" + ");
    const draftCount = batch.reduce((n, ch) => n + (draftMap.get(ch)?.length || 0), 0);
    const body =
      draftCount > 0
        ? `${draftCount} approved draft${draftCount > 1 ? "s" : ""} ready — peak window open now.`
        : `Peak window open on ${labels}. Review and publish when ready.`;

    const n = await sendToUser(sql, userId, {
      title: `Time to publish · ${labels}`,
      body,
      url: `/app?tab=agents&channel=${batch[0]}`,
      tag: "publish-reminder",
    });
    if (n) {
      await recordReminder(sql, userId, key);
      sent += n;
    }
  }

  return NextResponse.json({ ok: true, sent });
}
