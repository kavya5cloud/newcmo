import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { accessForUser, accessMessage } from "@/lib/billing/gate";
import { isSafePublicUrl, rateLimit, requestKey } from "@/lib/throttle";
import { streamText } from "@/lib/services/llm-stream";

export const runtime = "nodejs";

// Generation, as it is written.
//
// Same gates as /api/generate — auth, rate limit, access, URL safety — because a streaming
// endpoint that skips them is just the old endpoint with the checks removed. The only
// difference is what comes back.
//
// Server-sent events rather than a raw text stream: SSE frames each chunk, so a "done" event
// carrying the provider and model can travel alongside the text, and an error partway
// through arrives as an error rather than as the text simply stopping.

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 20 : 8, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", hint: `Too many requests. Try again in ${limit.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  if (session) {
    const access = await accessForUser(session.userId);
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason, hint: accessMessage(access) }, { status: 402 });
    }
  }

  let payload: { prompt?: string; url?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", hint: "The request was malformed." }, { status: 400 });
  }

  const prompt = (payload.prompt || "").trim();
  if (!prompt) return NextResponse.json({ error: "empty_prompt", hint: "Nothing was sent to generate from." }, { status: 400 });
  if (prompt.length > 10_000) {
    return NextResponse.json({ error: "prompt_too_large", hint: "That request is too long — shorten it." }, { status: 413 });
  }
  if (payload.url && !isSafePublicUrl(payload.url)) {
    return NextResponse.json({ error: "unsafe_url", hint: "Use a public http(s) website URL." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        for await (const event of streamText(prompt)) send(event);
      } catch {
        // The generator already reports what it can; this is the last resort so the client
        // is never left holding an open socket that will not speak again.
        send({ type: "error", message: "The response ended unexpectedly." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Without this some proxies buffer the whole response and hand it over at the end,
      // which is the exact behaviour this endpoint exists to avoid.
      "X-Accel-Buffering": "no",
    },
  });
}
