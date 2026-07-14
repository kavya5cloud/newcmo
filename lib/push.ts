import webpush from "web-push";
import type { Sql } from "@/lib/db";
import type { NotificationPrefs } from "@/lib/publish-times";
import { DEFAULT_PREFS } from "@/lib/publish-times";

export type PushSubscription = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function vapidConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || "";
}

export function initWebPush() {
  if (!vapidConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:hello@cosmos.ai",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  return true;
}

export async function ensurePushTables(sql: Sql) {
  await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS notification_prefs (
    user_id TEXT PRIMARY KEY,
    prefs JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sent_reminders (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    reminder_key TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS sent_reminders_user_key ON sent_reminders (user_id, reminder_key, sent_at)`;
}

export async function saveSubscription(
  sql: Sql,
  userId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
  await ensurePushTables(sql);
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
    VALUES (${id}, ${userId}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
  `;
}

export async function removeSubscription(sql: Sql, userId: string, endpoint: string) {
  await ensurePushTables(sql);
  await sql`DELETE FROM push_subscriptions WHERE user_id = ${userId} AND endpoint = ${endpoint}`;
}

export async function getSubscriptions(sql: Sql, userId: string): Promise<PushSubscription[]> {
  await ensurePushTables(sql);
  return (await sql`SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId}`) as PushSubscription[];
}

export async function getPrefs(sql: Sql, userId: string): Promise<NotificationPrefs> {
  await ensurePushTables(sql);
  const rows = (await sql`SELECT prefs FROM notification_prefs WHERE user_id = ${userId}`) as { prefs: NotificationPrefs }[];
  return { ...DEFAULT_PREFS, ...(rows[0]?.prefs || {}) };
}

export async function savePrefs(sql: Sql, userId: string, prefs: NotificationPrefs) {
  await ensurePushTables(sql);
  await sql`
    INSERT INTO notification_prefs (user_id, prefs, updated_at)
    VALUES (${userId}, ${JSON.stringify(prefs)}, now())
    ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()
  `;
}

export async function wasReminderSentToday(sql: Sql, userId: string, key: string): Promise<boolean> {
  await ensurePushTables(sql);
  const rows = (await sql`
    SELECT 1 FROM sent_reminders
    WHERE user_id = ${userId} AND reminder_key = ${key}
      AND sent_at > now() - interval '1 day'
    LIMIT 1
  `) as unknown[];
  return rows.length > 0;
}

export async function countRemindersToday(sql: Sql, userId: string): Promise<number> {
  await ensurePushTables(sql);
  const rows = (await sql`
    SELECT count(*)::int AS n FROM sent_reminders
    WHERE user_id = ${userId} AND sent_at > now() - interval '1 day'
  `) as { n: number }[];
  return rows[0]?.n || 0;
}

export async function recordReminder(sql: Sql, userId: string, key: string) {
  await ensurePushTables(sql);
  await sql`INSERT INTO sent_reminders (id, user_id, reminder_key) VALUES (${crypto.randomUUID()}, ${userId}, ${key})`;
}

export async function sendPush(
  sub: PushSubscription,
  payload: { title: string; body: string; url?: string; tag?: string }
) {
  if (!initWebPush()) return false;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (e: unknown) {
    const status = (e as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) return false;
    throw e;
  }
}

export async function sendToUser(
  sql: Sql,
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
) {
  const subs = await getSubscriptions(sql, userId);
  let sent = 0;
  for (const sub of subs) {
    const ok = await sendPush(sub, payload);
    if (ok) sent++;
    else await sql`DELETE FROM push_subscriptions WHERE id = ${sub.id}`;
  }
  return sent;
}
