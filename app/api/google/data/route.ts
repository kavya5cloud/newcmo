import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessToken, queryAnalytics, isoDaysAgo } from "@/lib/google";
import { matchGscSite } from "@/lib/gsc-match";
import { rateLimit, requestKey } from "@/lib/throttle";

export const runtime = "nodejs";

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(Math.round(n));
}

function pctDelta(cur: number, prev: number): string {
  if (!prev) return cur ? "+100%" : "—";
  const d = ((cur - prev) / prev) * 100;
  const sign = d >= 0 ? "+" : "";
  return sign + d.toFixed(1) + "%";
}

type Row = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 20, 60_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });
  }
  const sql = db();
  if (!session || !sql) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let site = req.nextUrl.searchParams.get("site");
  const analyzedUrl = req.nextUrl.searchParams.get("url") || "";
  const range = req.nextUrl.searchParams.get("range") === "30d" ? 30 : 7;
  const token = await getAccessToken(sql, session.userId);
  if (token) {
    const { listSites } = await import("@/lib/google");
    const sites = await listSites(token);
    const match = matchGscSite(sites, analyzedUrl);
    if (!site || !sites.includes(site)) site = match || site || sites[0] || null;
  }
  if (!site) return NextResponse.json({ error: "no_site" }, { status: 400 });

  try {
    if (!token) return NextResponse.json({ error: "not_connected" }, { status: 403 });

    const start = isoDaysAgo(range + 2);
    const end = isoDaysAgo(2);
    const prevStart = isoDaysAgo(range * 2 + 2);
    const prevEnd = isoDaysAgo(range + 3);

    const [totals, prevTotals, byDate, byQuery, prevByQuery, byPage, byHour] = await Promise.all([
      queryAnalytics(token, site, start, end, []),
      queryAnalytics(token, site, prevStart, prevEnd, []),
      queryAnalytics(token, site, start, end, ["date"]),
      queryAnalytics(token, site, start, end, ["query"]),
      queryAnalytics(token, site, prevStart, prevEnd, ["query"]),
      queryAnalytics(token, site, start, end, ["page"]),
      queryAnalytics(token, site, start, end, ["hour"]),
    ]);

    const t = totals[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const pt = prevTotals[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    const prevQueryMap = new Map<string, Row>();
    for (const r of prevByQuery) prevQueryMap.set(r.keys?.[0] || "", r);

    const series = {
      labels: byDate.map((r) => (r.keys?.[0] || "").slice(5)),
      impressions: byDate.map((r) => r.impressions),
      clicks: byDate.map((r) => r.clicks),
    };

    const queries = byQuery.slice(0, 8).map((r) => {
      const q = r.keys?.[0] || "";
      const prev = prevQueryMap.get(q);
      const posDelta = prev ? Math.round(prev.position - r.position) : 0;
      let trend = (r.clicks || 0) + " clk";
      if (posDelta > 0) trend = "↑" + posDelta;
      else if (posDelta < 0) trend = "↓" + Math.abs(posDelta);
      else if (!prev) trend = "new";
      return { pos: "#" + Math.round(r.position), query: q, trend, clicks: r.clicks, impressions: r.impressions, ctr: (r.ctr * 100).toFixed(1) + "%" };
    });

    const pages = byPage
      .filter((r) => r.impressions >= 10)
      .sort((a, b) => a.ctr - b.ctr)
      .slice(0, 5)
      .map((r) => ({
        page: (r.keys?.[0] || "").replace(/^https?:\/\/[^/]+/, "") || "/",
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: (r.ctr * 100).toFixed(1) + "%",
        position: r.position.toFixed(1),
      }));

    const hourClicks = byHour.map((r) => ({
      hour: Number(r.keys?.[0] || 0),
      clicks: r.clicks,
    }));

    return NextResponse.json({
      site,
      impressions: fmt(t.impressions),
      clicks: fmt(t.clicks),
      ctr: (t.ctr * 100).toFixed(1) + "%",
      position: t.position.toFixed(1),
      deltas: {
        impressions: pctDelta(t.impressions, pt.impressions),
        clicks: pctDelta(t.clicks, pt.clicks),
        ctr: pctDelta(t.ctr, pt.ctr),
        position: pt.position ? (t.position - pt.position).toFixed(1) : "—",
      },
      series,
      queries,
      pages,
      hourClicks,
    });
  } catch (e) {
    return NextResponse.json({ error: "fetch_failed", detail: String(e).slice(0, 150) }, { status: 502 });
  }
}
