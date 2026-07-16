import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isTrialActive } from "@/lib/trial";
import { isSafePublicUrl, rateLimit, requestKey } from "@/lib/throttle";

export const runtime = "nodejs";

// Providers are tried in order; the first with a valid key wins.
// All speak the OpenAI chat-completions format, so one call path serves all.
const PROVIDERS = [
  {
    name: "groq",
    env: "GROQ_API_KEY",
    prefix: "gsk_",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: process.env.GROQ_MODEL || "llama-3.1-8b-instant",
  },
  {
    name: "openai",
    env: "OPENAI_API_KEY",
    prefix: "sk-",
    url: "https://api.openai.com/v1/chat/completions",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
];

function activeProvider() {
  for (const p of PROVIDERS) {
    const key = (process.env[p.env] || "").trim();
    if (key.startsWith(p.prefix)) return { provider: p, key };
  }
  return { provider: null, key: "" };
}

async function fetchSiteText(url: string, cap = 6000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Populr analyzer)" },
      signal: controller.signal,
    });
    clearTimeout(t);
    let html = await r.text();
    html = html.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ");
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text.slice(0, cap) || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 20 : 8, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", hint: "slow down and try again" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  let payload: { prompt?: string; url?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Enforce the free trial server-side: a signed-in account past its trial is blocked
  // (anonymous/no-DB usage stays open as a demo).
  if (session && !(await isTrialActive(session.userId))) {
    return NextResponse.json({ error: "trial_ended", hint: "your free month has ended — upgrade to continue" }, { status: 402 });
  }

  const { provider, key } = activeProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "no_api_key", hint: "set GROQ_API_KEY in .env.local (free key at console.groq.com)" },
      { status: 503 }
    );
  }

  let prompt = (payload.prompt || "").trim();
  if (prompt.length > 10_000) return NextResponse.json({ error: "prompt_too_large" }, { status: 413 });
  if (!prompt) return NextResponse.json({ error: "empty_prompt" }, { status: 400 });

  if (payload.url) {
    if (!isSafePublicUrl(payload.url)) {
      return NextResponse.json({ error: "unsafe_url", hint: "use a public http(s) website URL" }, { status: 400 });
    }
    const site = await fetchSiteText(payload.url);
    prompt = site
      ? `Below is the text content of ${payload.url} (fetched just now):\n---\n${site}\n---\n\n${prompt}`
      : `(Note: ${payload.url} could not be fetched — infer what you can from the domain name.)\n\n${prompt}`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    const r = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
        "User-Agent": "populr/1.0",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
      }),
    }).finally(() => clearTimeout(timeout));
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 400);
      return NextResponse.json(
        { error: "llm_error", provider: provider.name, detail },
        { status: r.status }
      );
    }
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ text, provider: provider.name });
  } catch (e) {
    return NextResponse.json(
      { error: "upstream_failed", detail: String(e).slice(0, 200) },
      { status: 502 }
    );
  }
}
