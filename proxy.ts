import { NextRequest, NextResponse } from "next/server";
import { isContentEngineApi, isContentEnginePath } from "@/lib/flags";

// One choke point for the content engine being switched off.
//
// This is Next 16's proxy convention (the former middleware.ts, which now warns).
//
// The entry points were removed from the landing page, the dashboard and the Studio nav,
// but removing links is not the same as being unreachable: bookmarks, browser history and
// guessed URLs all still arrive. This turns those away.
//
// Nothing is deleted. Flip NEXT_PUBLIC_SHOW_CONTENT_ENGINE=1 and every route below answers
// normally again.

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Generation endpoints answer 404 rather than a redirect: an API client that follows a
  // 302 to an HTML page gets a confusing parse error instead of a clear answer.
  if (isContentEngineApi(pathname)) {
    return NextResponse.json(
      { error: "not_available", hint: "The content engine is turned off." },
      { status: 404 },
    );
  }

  if (isContentEnginePath(pathname)) {
    const to = req.nextUrl.clone();
    to.pathname = "/app";
    to.search = "";
    // Temporary on purpose. A 308 would be cached by the browser and would survive the
    // flag being turned back on.
    return NextResponse.redirect(to, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/studio", "/studio/:path*", "/api/content/:path*", "/api/ugc/:path*"],
};
