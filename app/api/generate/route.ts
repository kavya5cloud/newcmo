import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { isTrialActive } from "@/lib/trial";
import { isSafePublicUrl, rateLimit, requestKey } from "@/lib/throttle";

export const runtime = "nodejs";

type ProviderConfig = {
  name: "groq" | "openai";
  env: "GROQ_API_KEY" | "OPENAI_API_KEY";
  prefix: string;
  url: string;
  model: string;
};

type LLMAttempt = {
  provider: string;
  model: string;
  status: number;
  elapsedMs: number;
  kind: string;
  body: string;
  retried?: boolean;
};

// Providers are tried in order; the first configured one wins.
// All speak the OpenAI chat-completions format, so one call path serves all.
const PROVIDERS: ProviderConfig[] = [
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

function envValue(name: ProviderConfig["env"]) {
  return (process.env[name] || "").trim();
}

function activeProvider() {
  for (const p of PROVIDERS) {
    const key = envValue(p.env);
    if (key) return { provider: p, key };
  }
  return { provider: null, key: "" };
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function classifyUpstream(status: number, body: string) {
  const text = body.toLowerCase();
  if (status === 429) {
    if (/(quota|billing|insufficient|exceed|exhaust)/.test(text)) return "quota_exhausted";
    return "rate_limit";
  }
  if (status === 401 || status === 403 || /(invalid api key|unauthorized|authentication|api key)/.test(text)) return "invalid_api_key";
  if (status === 400 || /(bad request|malformed|invalid request|missing parameter)/.test(text)) return "malformed_request";
  if (/(model .*not found|model .*unavailable|unsupported model|does not exist)/.test(text)) return "model_unavailable";
  if (status >= 500) return "upstream_error";
  return "llm_error";
}

function statusForKind(kind: string) {
  switch (kind) {
    case "rate_limit":
    case "quota_exhausted":
      return 429;
    case "invalid_api_key":
      return 401;
    case "malformed_request":
      return 400;
    case "model_unavailable":
      return 503;
    default:
      return 502;
  }
}

function logEvent(event: string, data: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...data }));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callProvider(provider: ProviderConfig, key: string, prompt: string, requestId: string, retried = false): Promise<{ ok: true; text: string } | { ok: false; attempt: LLMAttempt }> {
  const started = Date.now();
  logEvent("llm_generate_attempt", {
    requestId,
    provider: provider.name,
    model: provider.model,
    envLoaded: true,
    keyPrefixMatch: key.startsWith(provider.prefix),
    retried,
    appUrlConfigured: Boolean(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(provider.url, {
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
    });
    const body = await response.text();
    const elapsedMs = Date.now() - started;
    if (!response.ok) {
      const kind = classifyUpstream(response.status, body);
      logEvent("llm_generate_failure", {
        requestId,
        provider: provider.name,
        model: provider.model,
        status: response.status,
        elapsedMs,
        kind,
        body,
        retried,
      });
      return {
        ok: false,
        attempt: { provider: provider.name, model: provider.model, status: response.status, elapsedMs, kind, body, retried },
      };
    }

    const parsed = safeJson(body);
    const text = parsed?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      const invalidKind = "invalid_json";
      logEvent("llm_generate_failure", {
        requestId,
        provider: provider.name,
        model: provider.model,
        status: 502,
        elapsedMs,
        kind: invalidKind,
        body,
        retried,
      });
      return {
        ok: false,
        attempt: {
          provider: provider.name,
          model: provider.model,
          status: 502,
          elapsedMs,
          kind: invalidKind,
          body,
          retried,
        },
      };
    }

    logEvent("llm_generate_success", {
      requestId,
      provider: provider.name,
      model: provider.model,
      status: response.status,
      elapsedMs,
      kind: "success",
      retried,
    });

    return { ok: true, text };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const body = error instanceof Error ? error.message : String(error);
    const kind = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    logEvent("llm_generate_failure", {
      requestId,
      provider: provider.name,
      model: provider.model,
      status: 502,
      elapsedMs,
      kind,
      body,
      retried,
    });
    return {
      ok: false,
      attempt: { provider: provider.name, model: provider.model, status: 502, elapsedMs, kind, body, retried },
    };
  } finally {
    clearTimeout(timeout);
  }
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
  const requestId = randomUUID();
  const started = Date.now();
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
  const openai = PROVIDERS[1];
  const openaiKey = envValue("OPENAI_API_KEY");
  logEvent("llm_generate_request", {
    requestId,
    route: "/api/generate",
    appUrlConfigured: Boolean(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL),
    groqKeyLoaded: Boolean(envValue("GROQ_API_KEY")),
    openaiKeyLoaded: Boolean(openaiKey),
    selectedProvider: provider?.name || null,
    selectedModel: provider?.model || null,
  });

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

  const primary = await callProvider(provider, key, prompt, requestId);
  if (primary.ok) {
    logEvent("llm_generate_complete", {
      requestId,
      provider: provider.name,
      model: provider.model,
      status: 200,
      elapsedMs: Date.now() - started,
    });
    return NextResponse.json({ text: primary.text, provider: provider.name });
  }

  const primaryAttempt = primary.attempt;
  if (provider.name === "groq" && primaryAttempt.status === 429) {
    await sleep(2000);
    const retry = await callProvider(provider, key, prompt, requestId, true);
    if (retry.ok) {
      logEvent("llm_generate_complete", {
        requestId,
        provider: provider.name,
        model: provider.model,
        status: 200,
        elapsedMs: Date.now() - started,
        retried: true,
      });
      return NextResponse.json({ text: retry.text, provider: provider.name });
    }

    const retryAttempt = retry.attempt;
    if (openaiKey) {
      logEvent("llm_generate_fallback", {
        requestId,
        fromProvider: provider.name,
        toProvider: openai.name,
        fromStatus: retryAttempt.status,
        fromKind: retryAttempt.kind,
        elapsedMs: Date.now() - started,
      });
      const openaiResult = await callProvider(openai, openaiKey, prompt, requestId);
      if (openaiResult.ok) {
        logEvent("llm_generate_complete", {
          requestId,
          provider: openai.name,
          model: openai.model,
          status: 200,
          elapsedMs: Date.now() - started,
          fallbackFrom: "groq",
        });
        return NextResponse.json({ text: openaiResult.text, provider: openai.name });
      }

      const fallbackAttempt = openaiResult.attempt;
      return NextResponse.json(
        {
          error: "llm_error",
          provider: fallbackAttempt.provider,
          model: fallbackAttempt.model,
          status: fallbackAttempt.status,
          kind: fallbackAttempt.kind,
          detail: fallbackAttempt.body,
          fallbackFrom: "groq",
          primary: primaryAttempt,
        },
        { status: statusForKind(fallbackAttempt.kind) }
      );
    }

    return NextResponse.json(
      {
        error: "llm_error",
        provider: retryAttempt.provider,
        model: retryAttempt.model,
        status: retryAttempt.status,
        kind: retryAttempt.kind,
        detail: retryAttempt.body,
        primary: primaryAttempt,
      },
      { status: statusForKind(retryAttempt.kind) }
    );
  }

  return NextResponse.json(
    {
      error: "llm_error",
      provider: primaryAttempt.provider,
      model: primaryAttempt.model,
      status: primaryAttempt.status,
      kind: primaryAttempt.kind,
      detail: primaryAttempt.body,
    },
    { status: statusForKind(primaryAttempt.kind) }
  );
}
