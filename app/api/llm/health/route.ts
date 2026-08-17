import { NextRequest, NextResponse } from "next/server";
import { PROVIDERS, configuredProviderNames } from "@/lib/services/llm";
import { rateLimit, requestKey } from "@/lib/throttle";

export const runtime = "nodejs";
export const maxDuration = 60;

// Which text providers actually work, right now, from production.
//
// Today the whole product answered "Every provider failed to respond." to every request, and
// finding out why took reading source, listing a vendor's model catalogue by hand, and
// diffing that against a hardcoded array. The information needed was: which providers have a
// key, which model leads, and what each one says when you call it. None of that was
// reachable without a laptop.
//
// The billing panel already proved the value of this shape. /api/billing returns a `config`
// block — server, product id prefix, hasToken, hasWebhookSecret — and a single request to it
// identified a sandbox/production mismatch that had defeated guessing for days. This is that,
// for generation.
//
// Two rules, because a diagnostic that leaks is worse than no diagnostic:
//
//   Never the key. Only whether one is present and its first few characters, which is enough
//   to tell "unset" from "set to the wrong thing" without being enough to use.
//
//   Never the account's data. Every probe sends the same fixed two-word prompt.

/** A live call per model, so the answer is what the provider does — not what we assume. */
async function probe(providerName: string, model: string, timeoutMs: number) {
  const provider = PROVIDERS.find((p) => p.name === providerName)!;
  const key = (process.env[provider.env] || "").trim();
  const started = Date.now();

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const gemini = provider.kind === "gemini";
    const url = gemini ? `${provider.url}/${model}:generateContent` : provider.url;
    const res = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        "Content-Type": "application/json",
        [provider.authHeader]: gemini ? key : `Bearer ${key}`,
      },
      body: JSON.stringify(
        gemini
          ? { contents: [{ parts: [{ text: "say ok" }] }], generationConfig: { maxOutputTokens: 2048 } }
          : { model, messages: [{ role: "user", content: "say ok" }], max_tokens: 2048 },
      ),
    });

    const raw = await res.text();
    let text = "";
    try {
      const j = JSON.parse(raw);
      text = gemini
        ? (j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
        : (j?.choices?.[0]?.message?.content ?? "");
    } catch { /* keep the body below instead */ }

    return {
      model,
      status: res.status,
      ms: Date.now() - started,
      // A 200 with no text is its own failure and the most confusing one to debug — the retry
      // logic cannot see it, so the chain stops on a model that answered nothing. Named.
      answered: res.ok && text.trim().length > 0,
      ...(res.ok && !text.trim() ? { note: "200 but empty — model spent its budget before answering" } : {}),
      ...(res.ok ? {} : { detail: raw.slice(0, 220) }),
    };
  } catch (e) {
    return {
      model,
      status: 0,
      ms: Date.now() - started,
      answered: false,
      detail: ctl.signal.aborted ? `timed out after ${timeoutMs}ms` : String(e).slice(0, 160),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: NextRequest) {
  // Public, so it can be checked from anywhere during an outage — including from a phone, and
  // including when nobody can sign in because the thing that is broken is sign-in. It reveals
  // no key material and no customer data. Rate limited so it cannot be turned into a way of
  // spending the generation budget.
  const limit = rateLimit(`llmhealth:${requestKey(req.headers)}`, 6, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", hint: `Try again in ${limit.retryAfter}s.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const deep = new URL(req.url).searchParams.get("probe") === "1";
  const configured = configuredProviderNames();

  const providers = await Promise.all(
    PROVIDERS.map(async (p) => {
      const key = (process.env[p.env] || "").trim();
      const row = {
        name: p.name,
        envVar: p.env,
        hasKey: Boolean(key),
        // Enough to spot a key pasted into the wrong variable — which happened with Polar
        // today, where an access token was sitting under POLAR_ENV.
        keyPrefix: key ? `${key.slice(0, 6)}…` : null,
        keyLooksRight: key ? key.startsWith(p.prefix) : null,
        inChain: configured.includes(p.name),
        leadModel: p.models[0] ?? null,
        models: p.models,
        // The override that silently kept production on a retired model even after the code
        // default was fixed. Surfaced by name so the next person sees it immediately.
        modelOverride: p.name === "groq" ? process.env.GROQ_MODEL || null
          : p.name === "gemini" ? process.env.GEMINI_MODEL || null
          : process.env.OPENAI_MODEL || null,
      };
      if (!deep || !key) return row;
      // 12s each, run together: a provider that is merely slow should not stop the report.
      return { ...row, probes: await Promise.all(p.models.map((m) => probe(p.name, m, 12_000))) };
    }),
  );

  const anyAnswered = providers.some((p) => "probes" in p && p.probes?.some((x) => x.answered));

  return NextResponse.json({
    ok: true,
    // The one-line verdict. With ?probe=1 it means a model actually answered; without it, only
    // that a provider is keyed — which is exactly the assumption that failed today.
    healthy: deep ? anyAnswered : configured.length > 0,
    probed: deep,
    configured,
    hint: deep
      ? undefined
      : "Add ?probe=1 to call every model. A key is not proof the model exists.",
    providers,
  }, { headers: { "Cache-Control": "no-store" } });
}
