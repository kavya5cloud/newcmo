import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { isTrialActive } from "@/lib/trial";
import { isSafePublicUrl, rateLimit, requestKey } from "@/lib/throttle";
import { db } from "@/lib/db";
import {
  sha256,
  getCachedAnalysis,
  putCachedAnalysis,
  getCachedSite,
  putCachedSite,
  touchCachedSite,
  ANALYSIS_TTL_MS,
  ANALYSIS_STALE_MS,
  SITE_TTL_MS,
} from "@/lib/ai-cache";
import type { Sql } from "@/lib/db";

export const runtime = "nodejs";

type ProviderConfig = {
  name: "groq" | "gemini" | "openai";
  env: "GROQ_API_KEY" | "GEMINI_API_KEY" | "OPENAI_API_KEY";
  prefix: string;
  url: string;
  // Ordered list of models to try for this provider. On an "unsupported model"
  // response we advance to the next entry before falling through to the next provider.
  models: string[];
  authHeader: "Authorization" | "x-goog-api-key";
  kind: "openai_compatible" | "gemini";
};

// Cap on generated tokens. Small, cheap models + short output = far less quota burn.
// 512 keeps CMO output (positioning, SEO, ideas, strategy, posts) tight but complete;
// bump via MAX_OUTPUT_TOKENS only if a section is getting truncated.
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 512);

function dedupe(list: string[]) {
  return [...new Set(list.filter(Boolean))];
}

// Rough token estimate (~4 chars/token) — good enough for logging/quota accounting.
function estTokens(chars: number) {
  return Math.ceil(chars / 4);
}

type LLMAttempt = {
  provider: string;
  model: string;
  status: number;
  elapsedMs: number;
  kind: string;
  body: string;
  retried?: boolean;
};

const PROVIDERS: ProviderConfig[] = [
  {
    name: "openai",
    env: "OPENAI_API_KEY",
    prefix: "sk-",
    url: "https://api.openai.com/v1/chat/completions",
    models: [process.env.OPENAI_MODEL || "gpt-4o-mini"],
    authHeader: "Authorization",
    kind: "openai_compatible",
  },
  {
    name: "gemini",
    env: "GEMINI_API_KEY",
    prefix: "",
    url: "https://generativelanguage.googleapis.com/v1beta/interactions",
    models: [process.env.GEMINI_MODEL || "gemini-3.5-flash"],
    authHeader: "x-goog-api-key",
    kind: "gemini",
  },
  {
    name: "groq",
    env: "GROQ_API_KEY",
    prefix: "gsk_",
    url: "https://api.groq.com/openai/v1/chat/completions",
    // Cheap, small, fast models — most dependable first. 8b-instant is rock-solid and
    // available on every Groq account; scout and compound-mini are newer fallbacks.
    // Each is a fraction of llama-3.3-70b's cost/token, cutting Groq quota burn hard.
    models: dedupe([
      process.env.GROQ_MODEL || "llama-3.1-8b-instant",
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "groq/compound-mini",
    ]),
    authHeader: "Authorization",
    kind: "openai_compatible",
  },
];

function envValue(name: ProviderConfig["env"]) {
  return (process.env[name] || "").trim();
}

function providerHasValidKey(provider: ProviderConfig, key: string) {
  if (!key) return false;
  if (!provider.prefix) return true;
  return key.startsWith(provider.prefix);
}

function isConfigured(provider: ProviderConfig, key: string) {
  return providerHasValidKey(provider, key);
}

function activeProvider() {
  for (const p of PROVIDERS) {
    const key = envValue(p.env);
    if (providerHasValidKey(p, key)) return { provider: p, key };
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
  if (status === 500 || status === 502 || status === 503) {
    if (/(model .*not found|model .*unavailable|unsupported model|does not exist)/.test(text)) return "model_unavailable";
    return "transient_error";
  }
  if (status === 401 || status === 403 || /(invalid api key|unauthorized|authentication|api key)/.test(text)) return "invalid_api_key";
  if (status === 400 || /(bad request|malformed|invalid request|missing parameter)/.test(text)) return "malformed_request";
  if (/(model .*not found|model .*unavailable|unsupported model|does not exist)/.test(text)) return "model_unavailable";
  if (status >= 500) return "transient_error";
  return "llm_error";
}

function statusForKind(kind: string) {
  switch (kind) {
    case "rate_limit":
    case "quota_exhausted":
    case "transient_error":
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

function isTransientStatus(status: number) {
  return status === 429 || status === 500 || status === 503;
}

function isUnsupportedModelAttempt(kind: string, body: string) {
  if (kind === "model_unavailable") return true;
  const text = body.toLowerCase();
  return /(model .*not found|model .*unavailable|unsupported model|does not exist)/.test(text);
}

async function callProvider(provider: ProviderConfig, model: string, key: string, prompt: string, requestId: string, retried = false): Promise<{ ok: true; text: string } | { ok: false; attempt: LLMAttempt }> {
  const started = Date.now();
  const promptChars = prompt.length;
  logEvent("llm_generate_attempt", {
    requestId,
    provider: provider.name,
    model,
    endpoint: provider.url,
    authHeader: provider.authHeader,
    envLoaded: true,
    keyLoaded: Boolean(key),
    keyPrefixMatch: provider.prefix ? key.startsWith(provider.prefix) : true,
    promptChars,
    estPromptTokens: estTokens(promptChars),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    retried,
    appUrlConfigured: Boolean(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const requestBody =
      provider.kind === "gemini"
        ? JSON.stringify({
            model,
            input: prompt,
            generation_config: { temperature: 0.7 },
          })
        : JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: MAX_OUTPUT_TOKENS,
          });
    const response = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [provider.authHeader]: provider.authHeader === "Authorization" ? "Bearer " + key : key,
        "User-Agent": "populr/1.0",
      },
      signal: controller.signal,
      body: requestBody,
    });
    const body = await response.text();
    const elapsedMs = Date.now() - started;
    logEvent("llm_provider_health", {
      requestId,
      provider: provider.name,
      model,
      latencyMs: elapsedMs,
      status: response.status,
      errorBody: response.ok ? null : body,
      retried,
    });
    if (!response.ok) {
      const kind = classifyUpstream(response.status, body);
      logEvent("llm_generate_failure", {
        requestId,
        provider: provider.name,
        model,
        status: response.status,
        elapsedMs,
        kind,
        body,
        retried,
      });
      return {
        ok: false,
        attempt: { provider: provider.name, model, status: response.status, elapsedMs, kind, body, retried },
      };
    }

    const parsed = safeJson(body);
    const text =
      provider.kind === "gemini"
        ? (typeof parsed?.output_text === "string"
            ? parsed.output_text
            : Array.isArray(parsed?.steps)
              ? parsed.steps
                  .flatMap((step: any) => Array.isArray(step?.content) ? step.content : [])
                  .reverse()
                  .find((part: any) => typeof part?.text === "string")?.text
              : null)
        : parsed?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      const invalidKind = "invalid_json";
      logEvent("llm_generate_failure", {
        requestId,
        provider: provider.name,
        model,
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
          model,
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
      model,
      status: response.status,
      elapsedMs,
      promptChars,
      estPromptTokens: estTokens(promptChars),
      outputChars: text.length,
      estOutputTokens: estTokens(text.length),
      kind: "success",
      retried,
    });

    return { ok: true, text };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const body = error instanceof Error ? error.message : String(error);
    const kind = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    logEvent("llm_provider_health", {
      requestId,
      provider: provider.name,
      model,
      latencyMs: elapsedMs,
      status: 0,
      errorBody: body,
      retried,
    });
    logEvent("llm_generate_failure", {
      requestId,
      provider: provider.name,
      model,
      status: 502,
      elapsedMs,
      kind,
      body,
      retried,
    });
    return {
      ok: false,
      attempt: { provider: provider.name, model, status: 502, elapsedMs, kind, body, retried },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1].trim() : "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function clean(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function collect(html: string, re: RegExp, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < max) {
    const t = clean(m[1]);
    const key = t.toLowerCase();
    // Skip empties and repeated blocks (nav items, boilerplate).
    if (t.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

async function fetchRawHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Populr analyzer)" },
      signal: controller.signal,
    });
    clearTimeout(t);
    return await r.text();
  } catch {
    return null;
  }
}

/**
 * Distill raw page HTML to a compact ~1500-char brief (title, meta description, H1,
 * a few headings, hero paragraph, key CTA) instead of dumping raw page text.
 * Aggressively strips scripts/styles, nav/header/footer, and cookie/legal boilerplate
 * so the LLM prompt stays tiny — the single biggest lever on Groq token/quota usage.
 */
function extractSummary(rawHtml: string, cap = 1500): string | null {
  try {
    let html = rawHtml;

    // Strip non-content and chrome/boilerplate blocks entirely before extraction.
    html = html
      .replace(/<(script|style|noscript|svg|template|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // cookie/consent/privacy/subscribe banners keyed by common class/id names
      .replace(/<[^>]+(?:class|id)\s*=\s*["'][^"']*(?:cookie|consent|gdpr|newsletter|subscribe|banner|modal|popup)[^"']*["'][^>]*>[\s\S]*?<\/[a-z]+>/gi, " ");

    // --- structured extraction ---
    const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) || "";
    const title = clean(titleTag);

    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    let description = "";
    for (const tag of metaTags) {
      const nameAttr = (attr(tag, "name") || attr(tag, "property")).toLowerCase();
      if (nameAttr === "description" || nameAttr === "og:description") {
        description = clean(attr(tag, "content"));
        if (nameAttr === "description" && description) break;
      }
    }

    const h1 = collect(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi, 1)[0] || "";
    const headings = collect(html, /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi, 3);
    // First substantial paragraph = hero/intro copy.
    const hero =
      collect(html, /<p[^>]*>([\s\S]*?)<\/p>/gi, 8).find((p) => p.length >= 40) || "";
    // Key CTA: first button or prominent action link.
    const cta =
      collect(html, /<(?:button|a)[^>]*>([\s\S]*?)<\/(?:button|a)>/gi, 40).find(
        (t) => /\b(get|start|try|book|sign|buy|demo|free|contact|subscribe|join|learn more)\b/i.test(t) && t.length <= 40
      ) || "";

    const parts = [
      title && `Title: ${title}`,
      description && `Description: ${description}`,
      h1 && `H1: ${h1}`,
      headings.length && `Headings: ${headings.join(" | ")}`,
      hero && `Hero: ${hero}`,
      cta && `CTA: ${cta}`,
    ].filter(Boolean);

    let brief = parts.join("\n");
    // Fallback: if the page yielded almost nothing structured, use trimmed body text.
    if (brief.replace(/\s+/g, "").length < 40) {
      brief = clean(html);
    }
    brief = brief.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
    return brief.slice(0, cap) || null;
  } catch {
    return null;
  }
}

/**
 * Get a compact summary for a URL, using the scrape cache to avoid re-work:
 *   1. Fresh cache (within SITE_TTL) → reuse summary, skip the fetch entirely.
 *   2. Fetch HTML, hash it. If the hash matches the cached one → reuse the stored
 *      summary (page unchanged), just refresh its timestamp.
 *   3. Otherwise extract a new summary and store it with the new hash.
 * Falls back to a plain fetch+extract when no DB is configured.
 */
async function siteSummary(sql: Sql | null, url: string, requestId: string): Promise<string | null> {
  if (sql) {
    const cached = await getCachedSite(sql, url);
    if (cached && cached.ageMs <= SITE_TTL_MS) {
      logEvent("site_cache_hit", { requestId, url, reason: "fresh", ageMs: Math.round(cached.ageMs), summaryChars: cached.summary.length });
      return cached.summary;
    }
    const html = await fetchRawHtml(url);
    if (!html) return cached?.summary ?? null; // fetch failed → serve stale summary if we have one
    const hash = sha256(html);
    if (cached && cached.htmlHash === hash) {
      await touchCachedSite(sql, url);
      logEvent("site_cache_hit", { requestId, url, reason: "html_unchanged", summaryChars: cached.summary.length });
      return cached.summary;
    }
    const summary = extractSummary(html);
    if (summary) {
      await putCachedSite(sql, url, hash, summary);
      logEvent("site_cache_store", { requestId, url, summaryChars: summary.length });
    }
    return summary;
  }
  const html = await fetchRawHtml(url);
  return html ? extractSummary(html) : null;
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

  const rawPrompt = (payload.prompt || "").trim();
  if (rawPrompt.length > 10_000) return NextResponse.json({ error: "prompt_too_large" }, { status: 413 });
  if (!rawPrompt) return NextResponse.json({ error: "empty_prompt" }, { status: 400 });
  if (payload.url && !isSafePublicUrl(payload.url)) {
    return NextResponse.json({ error: "unsafe_url", hint: "use a public http(s) website URL" }, { status: 400 });
  }

  const sql = db();
  // Cache key covers URL + the exact prompt, so the same analysis of the same site
  // (across users) is a hit — but a different section/prompt for that site is not.
  const cacheKey = sha256((payload.url || "") + "\n" + rawPrompt);

  // Fresh analysis cache → return instantly, no fetch and no LLM call at all.
  if (sql) {
    const hit = await getCachedAnalysis(sql, cacheKey, ANALYSIS_TTL_MS);
    if (hit) {
      logEvent("analysis_cache_hit", {
        requestId,
        url: payload.url || null,
        provider: hit.provider,
        model: hit.model,
        ageMs: Math.round(hit.ageMs),
        elapsedMs: Date.now() - started,
      });
      return NextResponse.json({ text: hit.text, provider: hit.provider, cached: true });
    }
  }

  const configuredProviders = PROVIDERS.map((provider) => ({ provider, key: envValue(provider.env) }))
    .filter(({ provider, key }) => isConfigured(provider, key));
  logEvent("llm_generate_request", {
    requestId,
    route: "/api/generate",
    appUrlConfigured: Boolean(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL),
    groqKeyLoaded: Boolean(envValue("GROQ_API_KEY")),
    geminiKeyLoaded: Boolean(envValue("GEMINI_API_KEY")),
    openaiKeyLoaded: Boolean(envValue("OPENAI_API_KEY")),
    providerChain: configuredProviders.map(({ provider }) => provider.name),
  });

  if (!configuredProviders.length) {
    return NextResponse.json(
      { error: "no_api_key", hint: "set GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY in .env.local" },
      { status: 503 }
    );
  }

  let prompt = rawPrompt;
  if (payload.url) {
    const site = await siteSummary(sql, payload.url, requestId);
    prompt = site
      ? `Key page details for ${payload.url} (fetched just now):\n---\n${site}\n---\n\n${prompt}`
      : `(Note: ${payload.url} could not be fetched — infer what you can from the domain name.)\n\n${prompt}`;
  }

  // Store a successful analysis in the cache, then return it.
  const succeed = async (text: string, providerName: string, model: string, retried: boolean) => {
    if (sql) await putCachedAnalysis(sql, cacheKey, payload.url || null, text, providerName, model);
    logEvent("llm_generate_complete", {
      requestId,
      provider: providerName,
      model,
      status: 200,
      elapsedMs: Date.now() - started,
      ...(retried ? { retried: true } : {}),
    });
    return NextResponse.json({ text, provider: providerName, cached: false });
  };

  let lastAttempt: LLMAttempt | null = null;

  // Provider fallback: Groq → Gemini → OpenAI. Within a provider we walk its model
  // list (Groq: 8b-instant → llama-4-scout → compound-mini) so an unavailable/limited
  // model drops to another before we abandon the provider entirely.
  provider: for (const { provider, key } of configuredProviders) {
    model: for (const model of provider.models) {
      let attempt = await callProvider(provider, model, key, prompt, requestId);
      if (attempt.ok) {
        return succeed(attempt.text, provider.name, model, false);
      }

      let currentAttempt = attempt.attempt;
      lastAttempt = currentAttempt;

      // Model not available on this provider → try the next model in the chain.
      if (isUnsupportedModelAttempt(currentAttempt.kind, currentAttempt.body)) {
        logEvent("llm_model_skip", {
          requestId,
          provider: provider.name,
          model,
          reason: "unsupported_model",
          status: currentAttempt.status,
          elapsedMs: currentAttempt.elapsedMs,
        });
        continue model;
      }

      // Non-transient failure (bad key, malformed request, …) → whole provider is out.
      if (!isTransientStatus(currentAttempt.status)) {
        logEvent("llm_provider_skip", {
          requestId,
          provider: provider.name,
          model,
          reason: currentAttempt.kind,
          status: currentAttempt.status,
          elapsedMs: currentAttempt.elapsedMs,
        });
        continue provider;
      }

      // Transient (rate limit / quota / 5xx): short backoff-retry on the same model.
      for (const delayMs of [2000, 4000]) {
        await sleep(delayMs);
        attempt = await callProvider(provider, model, key, prompt, requestId, true);
        if (attempt.ok) {
          return succeed(attempt.text, provider.name, model, true);
        }
        currentAttempt = attempt.attempt;
        lastAttempt = currentAttempt;
        if (isUnsupportedModelAttempt(currentAttempt.kind, currentAttempt.body)) {
          continue model;
        }
        if (!isTransientStatus(currentAttempt.status)) {
          continue provider;
        }
      }
      // Still transient after retries → drop to the next (cheaper) model in the chain,
      // which has its own quota bucket, before giving up on the provider.
      logEvent("llm_model_skip", {
        requestId,
        provider: provider.name,
        model,
        reason: "transient_exhausted",
        status: currentAttempt.status,
        elapsedMs: currentAttempt.elapsedMs,
        retried: true,
      });
    }
  }

  logEvent("llm_generate_complete", {
    requestId,
    provider: lastAttempt?.provider || null,
    model: lastAttempt?.model || null,
    status: lastAttempt?.status || 0,
    elapsedMs: Date.now() - started,
    exhaustedProviders: true,
  });

  // Every provider failed → serve the last successful analysis for this exact request
  // if we have one within the stale window, so the user gets a real result, not an error.
  if (sql) {
    const stale = await getCachedAnalysis(sql, cacheKey, ANALYSIS_STALE_MS);
    if (stale) {
      logEvent("analysis_cache_stale_served", {
        requestId,
        url: payload.url || null,
        provider: stale.provider,
        model: stale.model,
        ageMs: Math.round(stale.ageMs),
        elapsedMs: Date.now() - started,
      });
      return NextResponse.json({ text: stale.text, provider: stale.provider, cached: true, stale: true });
    }
  }

  return NextResponse.json(
    {
      error: "ai_temporarily_unavailable",
      message: "Our AI providers are temporarily busy. Please try again in a minute.",
    },
    { status: 503 }
  );
}
