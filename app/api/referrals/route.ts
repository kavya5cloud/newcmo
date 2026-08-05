import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { SITE_URL } from "@/lib/seo";
import { REFERRALS_PER_REWARD, REWARD_DAYS, codeForUser, describeProgress, shareLink } from "@/lib/referrals";
import { progressForUser } from "@/lib/referrals-store";

export const runtime = "nodejs";

// Your referral code, and what it has earned.
//
// Read-only. Credits are written at signup, by the person being referred — never by the
// referrer asking for them, which is the difference between a referral programme and a
// button that grants free months.

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "sign_in_required" }, { status: 401 });

  const limit = rateLimit(requestKey(req.headers, session.userId), 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }

  const code = codeForUser(session.userId);
  const progress = await progressForUser(session.userId);

  return NextResponse.json({
    ok: true,
    code,
    link: shareLink(SITE_URL, code),
    ...progress,
    summary: describeProgress(progress),
    terms: { perReward: REFERRALS_PER_REWARD, rewardDays: REWARD_DAYS },
  });
}
