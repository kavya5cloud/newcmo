import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  getVapidPublicKey,
  vapidConfigured,
  saveSubscription,
  removeSubscription,
  getSubscriptions,
  getPrefs,
  savePrefs,
  ensurePushTables,
} from "@/lib/push";
import type { NotificationPrefs } from "@/lib/publish-times";
import { DEFAULT_PREFS } from "@/lib/publish-times";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  const sql = db();
  if (!session || !sql) {
    return NextResponse.json({ configured: vapidConfigured(), subscribed: false, prefs: DEFAULT_PREFS });
  }
  await ensurePushTables(sql);
  const subs = await getSubscriptions(sql, session.userId);
  const prefs = await getPrefs(sql, session.userId);
  return NextResponse.json({
    configured: vapidConfigured(),
    publicKey: getVapidPublicKey(),
    subscribed: subs.length > 0,
    prefs,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const sql = db();
  if (!session || !sql) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!vapidConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const body = await req.json();
  if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
    return NextResponse.json({ error: "invalid_subscription" }, { status: 400 });
  }

  await saveSubscription(sql, session.userId, body);
  const prefs = await getPrefs(sql, session.userId);
  if (!prefs.timezone || prefs.timezone === "UTC") {
    const tz = body.timezone || "UTC";
    await savePrefs(sql, session.userId, { ...prefs, enabled: true, timezone: tz });
  } else if (!prefs.enabled) {
    await savePrefs(sql, session.userId, { ...prefs, enabled: true });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  const sql = db();
  if (!session || !sql) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body.endpoint) await removeSubscription(sql, session.userId, body.endpoint);

  const prefs = await getPrefs(sql, session.userId);
  await savePrefs(sql, session.userId, { ...prefs, enabled: false });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  const sql = db();
  if (!session || !sql) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const patch = (await req.json()) as Partial<NotificationPrefs>;
  const current = await getPrefs(sql, session.userId);
  const merged: NotificationPrefs = { ...current, ...patch };
  await savePrefs(sql, session.userId, merged);
  return NextResponse.json({ ok: true, prefs: merged });
}
