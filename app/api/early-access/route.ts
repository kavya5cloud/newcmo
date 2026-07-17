import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, requestKey } from "@/lib/throttle";
import { validateEaInput, saveApplication, sendWelcomeEmail } from "@/lib/early-access";

export const runtime = "nodejs";

// Public application intake for the Early Access Program.
export async function POST(req: NextRequest) {
  const limit = rateLimit(requestKey(req.headers), 6, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!sql) return NextResponse.json({ error: "no_database" }, { status: 503 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const v = validateEaInput(body);
  if (!v.ok) return NextResponse.json({ error: "invalid", fields: v.errors }, { status: 422 });

  try {
    const { created } = await saveApplication(sql, v.value);
    // Email is best-effort: the application is already saved, so a missing/failed
    // provider never blocks the signup. Only email brand-new applicants.
    let emailed = false;
    if (created) emailed = await sendWelcomeEmail(v.value.name, v.value.email);
    console.info(JSON.stringify({ event: "early_access_signup", created, emailed }));
    return NextResponse.json({ ok: true, created, emailed });
  } catch (e) {
    console.info(JSON.stringify({ event: "early_access_error", detail: String(e).slice(0, 200) }));
    return NextResponse.json({ error: "save_failed" }, { status: 502 });
  }
}
