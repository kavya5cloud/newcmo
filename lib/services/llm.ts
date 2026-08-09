import { randomUUID } from "node:crypto";
import { db, type Sql } from "@/lib/db";
import {
  sha256,
  buildCacheKey,
  getCachedAnalysis,
  putCachedAnalysis,
  getCachedSite,
  putCachedSite,
  touchCachedSite,
  ANALYSIS_TTL_MS,
  ANALYSIS_STALE_MS,
  SITE_TTL_MS,
} from "@/lib/ai-cache";

// ============================================================================
// LLM service — the single server-side entry point for text generation.
// Extracted from /api/generate so any server code (chat, campaigns, studio) can
// generate without a client round-trip. Owns: provider fallback chain, per-model
// retry/quota handling, URL-context injection, analysis caching, and in-flight
// de-duplication. Callers pass a finished prompt; this returns a structured result.
// ============================================================================


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

// Cap on generated tokens. 1024 gives full deliverables (articles, docs, multi-part
// analysis) room to finish without truncating mid-JSON; override via MAX_OUTPUT_TOKENS.
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 1024);

// Sampling temperature. Low (0.4) keeps answers grounded and factual and makes the
// JSON-shaped responses far more reliable than the provider default (1.0).
const LLM_TEMPERATURE = Number(process.env.LLM_TEMPERATURE || 0.4);

// Grounding system prompt sent with every generation. Forces the model to stay anchored
// to the supplied page details and stop inventing facts — the main accuracy lever after
// model choice.
const SYSTEM_PROMPT =
  "You are Populr, a precise AI CMO. Base every claim strictly on the page details and " +
  "context provided in the user message. Never invent statistics, traffic numbers, " +
  "competitors, features, or quotes that aren't supported by that input — if something " +
  "isn't given, reason from the domain and say what's an estimate. Be specific, concrete, " +
  "and concise. When asked for JSON, return only valid JSON with no markdown fences or prose.";

function dedupe(list: string[]) {
  return [...new Set(list.filter(Boolean))];
}

/**
 * Models this key provably cannot use.
 *
 * A 404 "does not exist or you do not have access" is permanent for a given key, but it was
 * being retried on every single request. In one cron run of ten slots that is twenty wasted
 * round-trips — and worse, it sat between the caller and a model that would have worked.
 *
 * Process-lifetime only, deliberately: if access is granted later, a deploy clears it.
 */
const deadModels = new Set<string>();
const deadKey = (provider: string, model: string) => `${provider}:${model}`;

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

export const PROVIDERS: ProviderConfig[] = [
  {
    // Primary when keyed: Google's free tier is generous and accurate, so it isn't
    // starved by Groq's tiny 70b daily cap. Real generateContent API (see callProvider).
    // The model name goes in the URL path per-model, so `url` here is just the base.
    name: "gemini",
    env: "GEMINI_API_KEY",
    prefix: "",
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    // Verified against a live key (Aug 2026): gemini-3.6-flash returns 200 on v1beta.
    //
    // The default used to be gemini-2.5-flash, which answered 404 "no longer available to
    // new users" — so anyone who set GEMINI_API_KEY without also setting GEMINI_MODEL got a
    // dead model at the front of the chain and never knew. The default is now a model that
    // was actually tested rather than assumed.
    //
    // Deliberately NOT an alias like gemini-flash-latest: an alias silently swaps the model
    // underneath you, and the prompt rules in lib/cmo/quality-rules.ts are tuned against
    // observed behaviour. A model changing mid-week with nothing in the diff to explain it
    // is how "the AI got worse again" happens.
    //
    // Note gemini-3.6-flash is a thinking model — it spent 76 thinking tokens answering
    // "say ok". Good for strategy, pure overhead for short copy. If token spend becomes a
    // problem again, cap it with generationConfig.thinkingConfig rather than downgrading.
    models: dedupe([
      process.env.GEMINI_MODEL || "gemini-3.6-flash",
      "gemini-2.5-flash",
    ]),
    authHeader: "x-goog-api-key",
    kind: "gemini",
  },
  {
    name: "groq",
    env: "GROQ_API_KEY",
    prefix: "gsk_",
    url: "https://api.groq.com/openai/v1/chat/completions",
    // Accuracy-first: the 70b model leads, falling back to the fast 8b-instant on rate
    // limits so a request degrades rather than dying. Override the lead with GROQ_MODEL.
    //
    // Two models were removed after production logs showed they never worked:
    // llama-4-scout returned 404 "does not exist or you do not have access" on every call,
    // and compound-mini's own 429 named llama-3.3-70b — it routes to the same model and
    // therefore shares the daily cap it was supposed to be a fallback for. Both cost a
    // round-trip per request and could never have answered one.
    models: dedupe([
      process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
    ]),
    authHeader: "Authorization",
    kind: "openai_compatible",
  },
  {
    // Last-resort fallback (only if an OpenAI key with billing is set).
    name: "openai",
    env: "OPENAI_API_KEY",
    prefix: "sk-",
    url: "https://api.openai.com/v1/chat/completions",
    models: [process.env.OPENAI_MODEL || "gpt-4o-mini"],
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
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            generationConfig: { temperature: LLM_TEMPERATURE, maxOutputTokens: MAX_OUTPUT_TOKENS },
          })
        : JSON.stringify({
            model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            max_tokens: MAX_OUTPUT_TOKENS,
            temperature: LLM_TEMPERATURE,
          });
    // Gemini puts the model + method in the URL path; OpenAI-compatible providers put the
    // model in the body and hit a single fixed endpoint.
    const endpoint =
      provider.kind === "gemini"
        ? `${provider.url}/${encodeURIComponent(model)}:generateContent`
        : provider.url;
    const response = await fetch(endpoint, {
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
        ? (Array.isArray(parsed?.candidates?.[0]?.content?.parts)
            ? parsed.candidates[0].content.parts
                .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
                .join("")
            : null)
        : parsed?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) {
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
function extractSummary(rawHtml: string, cap = 2600): string | null {
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
    const headings = collect(html, /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi, 8);
    // Substantial paragraphs = hero/intro/value copy. Keep the first few real ones so the
    // model actually sees what the product does, not just the tagline.
    const paras = collect(html, /<p[^>]*>([\s\S]*?)<\/p>/gi, 16)
      .filter((p) => p.length >= 40)
      .slice(0, 4);
    const hero = paras[0] || "";
    const body = paras.slice(1).join(" ");
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
      body && `Body: ${body}`,
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

type GenResult =
  | { ok: true; text: string; provider: string; model: string; retried: boolean }
  | { ok: false; lastAttempt: LLMAttempt | null };

// Per-instance in-flight de-duplication: concurrent requests for the same cacheKey share
// one generation instead of each firing its own LLM chain (thundering-herd guard). This is
// process-local — good enough on a warm instance; the Neon cache absorbs the rest across
// instances. Entries are removed as soon as the generation settles.
const inflight = new Map<string, Promise<GenResult>>();


export type GenerateResult =
  | { ok: true; text: string; provider: string; model?: string; cached: boolean; stale?: boolean; coalesced?: boolean }
  | { ok: false; status: number; error: string; message?: string };

/** Provider names that currently have a valid key (for logging + capability checks). */
export function configuredProviderNames(): string[] {
  return PROVIDERS.filter((p) => providerHasValidKey(p, envValue(p.env))).map((p) => p.name);
}

/**
 * Generate text for a finished prompt. Checks the analysis cache first, injects
 * scraped URL context when a url is given, walks the provider/model fallback chain,
 * de-dupes concurrent identical requests, and falls back to a stale cached answer
 * rather than erroring when every provider is exhausted.
 */
export async function generateText(opts: { prompt: string; url?: string | null; sql?: Sql | null; requestId?: string }): Promise<GenerateResult> {
  const requestId = opts.requestId || randomUUID();
  const started = Date.now();
  const rawPrompt = opts.prompt;
  const sql = opts.sql ?? db();
  const cacheKey = buildCacheKey(opts.url || null, rawPrompt);

  if (sql) {
    const hit = await getCachedAnalysis(sql, cacheKey, ANALYSIS_TTL_MS);
    if (hit) {
      logEvent("analysis_cache_hit", { requestId, url: opts.url || null, provider: hit.provider, model: hit.model, ageMs: Math.round(hit.ageMs), elapsedMs: Date.now() - started });
      return { ok: true, text: hit.text, provider: hit.provider || "cache", model: hit.model || undefined, cached: true };
    }
  }

  const configuredProviders = PROVIDERS.map((provider) => ({ provider, key: envValue(provider.env) }))
    .filter(({ provider, key }) => isConfigured(provider, key));
  logEvent("llm_generate_request", {
    requestId,
    appUrlConfigured: Boolean(process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL),
    providerChain: configuredProviders.map(({ provider }) => provider.name),
  });
  if (!configuredProviders.length) {
    return { ok: false, status: 503, error: "no_api_key", message: "set GROQ_API_KEY, GEMINI_API_KEY, or OPENAI_API_KEY" };
  }

  const runGeneration = async (): Promise<GenResult> => {
    let prompt = rawPrompt;
    if (opts.url) {
      const site = await siteSummary(sql, opts.url, requestId);
      prompt = site
        ? `Key page details for ${opts.url} (fetched just now):\n---\n${site}\n---\n\n${prompt}`
        : `(Note: ${opts.url} could not be fetched — infer what you can from the domain name.)\n\n${prompt}`;
    }
    let lastAttempt: LLMAttempt | null = null;
    provider: for (const { provider, key } of configuredProviders) {
      model: for (const model of provider.models) {
        if (deadModels.has(deadKey(provider.name, model))) continue model;
        let attempt = await callProvider(provider, model, key, prompt, requestId);
        if (attempt.ok) {
          if (sql) await putCachedAnalysis(sql, cacheKey, opts.url || null, attempt.text, provider.name, model);
          return { ok: true, text: attempt.text, provider: provider.name, model, retried: false };
        }
        let currentAttempt = attempt.attempt;
        lastAttempt = currentAttempt;
        if (isUnsupportedModelAttempt(currentAttempt.kind, currentAttempt.body)) {
          // Permanent for this key — never ask again this process.
          deadModels.add(deadKey(provider.name, model));
          logEvent("llm_model_skip", { requestId, provider: provider.name, model, reason: "unsupported_model", status: currentAttempt.status, remembered: true });
          continue model;
        }
        if (!isTransientStatus(currentAttempt.status)) {
          logEvent("llm_provider_skip", { requestId, provider: provider.name, model, reason: currentAttempt.kind, status: currentAttempt.status });
          continue provider;
        }
        if (currentAttempt.kind === "quota_exhausted") {
          logEvent("llm_model_skip", { requestId, provider: provider.name, model, reason: "quota_exhausted", status: currentAttempt.status });
          continue model;
        }
        for (const delayMs of [2000, 4000]) {
          await sleep(delayMs);
          attempt = await callProvider(provider, model, key, prompt, requestId, true);
          if (attempt.ok) {
            if (sql) await putCachedAnalysis(sql, cacheKey, opts.url || null, attempt.text, provider.name, model);
            return { ok: true, text: attempt.text, provider: provider.name, model, retried: true };
          }
          currentAttempt = attempt.attempt;
          lastAttempt = currentAttempt;
          if (isUnsupportedModelAttempt(currentAttempt.kind, currentAttempt.body)) {
            deadModels.add(deadKey(provider.name, model));
            continue model;
          }
          if (currentAttempt.kind === "quota_exhausted") continue model;
          if (!isTransientStatus(currentAttempt.status)) continue provider;
        }
        logEvent("llm_model_skip", { requestId, provider: provider.name, model, reason: "transient_exhausted", status: currentAttempt.status, retried: true });
      }
    }
    return { ok: false, lastAttempt };
  };

  const leader = !inflight.has(cacheKey);
  const gen = inflight.get(cacheKey) ?? runGeneration();
  if (leader) {
    inflight.set(cacheKey, gen);
    gen.finally(() => { if (inflight.get(cacheKey) === gen) inflight.delete(cacheKey); });
  }
  const result = await gen;

  if (result.ok) {
    logEvent("llm_generate_complete", { requestId, provider: result.provider, model: result.model, status: 200, elapsedMs: Date.now() - started, ...(result.retried ? { retried: true } : {}), ...(leader ? {} : { coalesced: true }) });
    return { ok: true, text: result.text, provider: result.provider, model: result.model, cached: false, ...(leader ? {} : { coalesced: true }) };
  }

  const lastAttempt = result.lastAttempt;
  logEvent("llm_generate_complete", { requestId, provider: lastAttempt?.provider || null, model: lastAttempt?.model || null, status: lastAttempt?.status || 0, elapsedMs: Date.now() - started, exhaustedProviders: true });

  if (sql) {
    const stale = await getCachedAnalysis(sql, cacheKey, ANALYSIS_STALE_MS);
    if (stale) {
      logEvent("analysis_cache_stale_served", { requestId, url: opts.url || null, provider: stale.provider, model: stale.model, ageMs: Math.round(stale.ageMs), elapsedMs: Date.now() - started });
      return { ok: true, text: stale.text, provider: stale.provider || "cache", model: stale.model || undefined, cached: true, stale: true };
    }
  }
  return { ok: false, status: 503, error: "ai_temporarily_unavailable", message: "Our AI providers are temporarily busy. Please try again in a minute." };
}
