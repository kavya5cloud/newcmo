import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { createLaunch } from "@/lib/launch/engine";
import { LAUNCH_TEMPLATE_IDS } from "@/lib/launch/templates";
import type { LaunchInput, LaunchTemplateId } from "@/lib/launch/types";
import { buildCalendar, calendarView } from "@/lib/publishing";
import type { CalendarView } from "@/lib/publishing/types";

export const runtime = "nodejs";

const VIEWS: CalendarView[] = ["day", "week", "month", "campaign", "mission", "platform"];

// Marketing Calendar — build the calendar for a launch and return it grouped by the
// requested view. Everything derives from the Launch Engine plan (Asset Graph source).
export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 15, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const launchType = String(body.launchType || "ai_tool_launch");
  if (!(LAUNCH_TEMPLATE_IDS as readonly string[]).includes(launchType)) {
    return NextResponse.json({ error: "invalid_launch_type", hint: LAUNCH_TEMPLATE_IDS.join(", ") }, { status: 422 });
  }
  const view = (VIEWS.includes(body.view as CalendarView) ? body.view : "week") as CalendarView;

  const input: LaunchInput = {
    launchType: launchType as LaunchTemplateId,
    mission: String(body.mission || "Launch"),
    business: { name: String(body.business || "Populr"), audience: String(body.audience || "founders") },
    timelineDays: typeof body.timelineDays === "number" ? body.timelineDays : 28,
  };

  const plan = createLaunch(input);
  const events = buildCalendar(plan);
  return NextResponse.json({ ok: true, view, buckets: calendarView(events, view), total: events.length });
}
