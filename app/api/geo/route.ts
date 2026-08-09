import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isTrialActive } from "@/lib/trial";
import { rateLimit, requestKey } from "@/lib/throttle";
import { runCitationCheck, summarize, reportToItems } from "@/lib/geo/check";
import { citationRepo } from "@/lib/geo/store";

export const runtime = "nodejs";

// AI-search visibility.
//
// GET  — the most recent report. Never runs a check, so a dashboard load costs nothing.
// POST — runs one. Four model calls, so it is rate limited hard and gated on the trial.
//
// The contract that matters: when there is no report, this returns `report: null`. It does
// not return a shape with plausible zeroes in it. The panel that reads this must be able to
// tell "not checked yet" from "checked, and you were not named", because those are opposite
// facts and the old hardcoded version could express neither.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const limit = rateLimit(requestKey(req.headers, session.userId), 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const report = await citationRepo().latest(session.userId).catch(() => null);
  if (!report) return NextResponse.json({ ok: true, report: null });

  return NextResponse.json({
    ok: true,
    report,
    summary: summarize(report),
    items: reportToItems(report),
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  // Four generations per run. Six an hour is enough to re-check after a change and nowhere
  // near enough to burn a daily token budget — a lesson this codebase learned the hard way.
  const limit = rateLimit(`geo:${requestKey(req.headers, session.userId)}`, 6, 3_600_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", hint: "AI-search checks are limited to a few per hour" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  if (!(await isTrialActive(session.userId))) {
    return NextResponse.json({ error: "trial_ended" }, { status: 402 });
  }

  let body: { brand?: string; host?: string; category?: string; audience?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const brand = (body.brand || "").trim().slice(0, 80);
  const host = (body.host || "").trim().slice(0, 120);
  const category = (body.category || "").trim().slice(0, 120);
  const audience = (body.audience || "").trim().slice(0, 80);

  // Without a category there is no fair question to ask — "what is the best ?" measures
  // nothing. Say so rather than checking something meaningless.
  if (!brand || !category) {
    return NextResponse.json(
      { error: "profile_incomplete", hint: "analyze your website first so we know your category" },
      { status: 400 },
    );
  }

  const report = await runCitationCheck({ tenant: session.userId, brand, host, category, audience });
  if (!report) {
    return NextResponse.json(
      { error: "check_unavailable", hint: "no AI provider is configured, so nothing was measured" },
      { status: 503 },
    );
  }

  await citationRepo().save(report).catch(() => {});   // a failed write must not lose the result

  return NextResponse.json({
    ok: true,
    report,
    summary: summarize(report),
    items: reportToItems(report),
  });
}
