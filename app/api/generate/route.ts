import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Providers are tried in order; the first with a valid key wins.
// All speak the OpenAI chat-completions format, so one call path serves all.
const PROVIDERS = [
  {
    name: "groq",
    env: "GROQ_API_KEY",
    prefix: "gsk_",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
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
      headers: { "User-Agent": "Mozilla/5.0 (cosmos.ai analyzer)" },
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
  let payload: { prompt?: string; url?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const { provider, key } = activeProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "no_api_key", hint: "set GROQ_API_KEY in .env.local (free key at console.groq.com)" },
      { status: 503 }
    );
  }

  let prompt = (payload.prompt || "").trim();
  if (!prompt) return NextResponse.json({ error: "empty_prompt" }, { status: 400 });

  if (payload.url) {
    const site = await fetchSiteText(payload.url);
    prompt = site
      ? `Below is the text content of ${payload.url} (fetched just now):\n---\n${site}\n---\n\n${prompt}`
      : `(Note: ${payload.url} could not be fetched — infer what you can from the domain name.)\n\n${prompt}`;
  }

  try {
    const r = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
        "User-Agent": "cosmos.ai/1.0",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1200,
      }),
    });
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
