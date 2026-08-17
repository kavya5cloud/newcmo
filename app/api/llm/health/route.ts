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

/**
 * A live call per model, so the answer is what the provider does — not what we assume.
 *
 * `mode` exists because the two paths are different endpoints with different failure modes,
 * and the first version of this file only checked one of them. It reported Gemini healthy
 * while the chat panel was quietly falling through to Groq, because chat streams and the
 * probe did not: Gemini streams from :streamGenerateContent, a separate method that can fail
 * on its own. A health check that passes while the product is degraded is worse than none.
 */
async function probe(providerName: string, model: string, timeoutMs: number, mode: "once" | "stream") {
  const provider = PROVIDERS.find((p) => p.name === providerName)!;
  const key = (process.env[provider.env] || "").trim();
  const started = Date.now();

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const gemini = provider.kind === "gemini";
    const streaming = mode === "stream";
    const url = gemini
      ? `${provider.url}/${encodeURIComponent(model)}:${streaming ? "streamGenerateContent?alt=sse" : "generateContent"}`
      : provider.url;
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
          : { model, messages: [{ role: "user", content: "say ok" }], max_tokens: 2048, ...(streaming ? { stream: true } : {}) },
      ),
    });

    const raw = await res.text();
    let text = "";
    if (streaming) {
      // SSE: many small frames, each a JSON object after "data:". Concatenating the deltas is
      // the only way to know text actually arrived rather than just a 200 and an open socket.
      for (const line of raw.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          text += gemini
            ? (j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
            : (j?.choices?.[0]?.delta?.content ?? "");
        } catch { /* a partial frame at the end is normal */ }
      }
    } else {
      try {
        const j = JSON.parse(raw);
        text = gemini
          ? (j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
          : (j?.choices?.[0]?.message?.content ?? "");
      } catch { /* keep the body below instead */ }
    }

    return {
      mode,
      model,
      status: res.status,
      ms: Date.now() - started,
      // A 200 with no text is its own failure and the most confusing one to debug — the retry
      // logic cannot see it, so the chain stops on a model that answered nothing. Named.
      answered: res.ok && text.trim().length > 0,
      ...(res.ok && !text.trim() ? { note: "200 but empty — model spent its budget before answering" } : {}),
      ...(res.status === 429 ? { note: "rate limited — the key and model are fine, the allowance is spent. The chain falls through to the next provider, which is working as designed." } : {}),
      ...(res.ok ? {} : { detail: raw.slice(0, 220) }),
    };
  } catch (e) {
    return {
      mode,
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

  const mode = new URL(req.url).searchParams.get("probe");
  const deep = mode === "1" || mode === "all";
  // ?probe=1 calls the lead model only; ?probe=all calls every model in every chain.
  //
  // This was ?probe=1 hitting everything, and it burned a free tier flat. Gemini's allowance
  // is small, each call spends two of it (single-shot plus stream), and ten runs of this
  // endpoint while debugging pushed the provider into 429 — so the diagnostic caused the
  // outage it then reported. A health check must not be able to degrade what it measures.
  //
  // The lead model is the honest default because it is the one that decides whether the
  // product works: if it answers, users are served by it, and if it does not, the fallbacks
  // are what the chain was built for. Use ?probe=all when auditing the whole chain, knowing
  // it costs a request per model per path.
  const everyModel = mode === "all";
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
      const targets = everyModel ? p.models : p.models.slice(0, 1);
      const probes = await Promise.all(
        targets.flatMap((m) => [probe(p.name, m, 12_000, "once"), probe(p.name, m, 12_000, "stream")]),
      );
      return { ...row, probedModels: targets.length, probes };
    }),
  );

  // "Can this serve a request?" — not "did anything, anywhere, answer?"
  //
  // The previous version asked whether some probe answered in each mode, across all
  // providers. It reported healthy while the product was returning "The model returned
  // nothing" to every user: Gemini's lead answered single-shot, a different Gemini model
  // answered streaming, and the two together satisfied the check. No single model could
  // actually serve a request, which is the only thing that matters.
  //
  // A provider serves when one of ITS models answers on BOTH paths. Anything less is a
  // provider that works for half the product.
  const servesFor = (p: (typeof providers)[number]) => {
    if (!("probes" in p) || !p.probes) return false;
    const models = new Set(p.probes.map((x) => x.model));
    return [...models].some((m) =>
      p.probes!.some((x) => x.model === m && x.mode === "once" && x.answered) &&
      p.probes!.some((x) => x.model === m && x.mode === "stream" && x.answered));
  };
  const withServes = providers.map((p) => (deep && "probes" in p ? { ...p, serves: servesFor(p) } : p));
  const anyAnswered = withServes.some((p) => "serves" in p && p.serves);

  // Things that are not yet an outage but caused one today. Each is a sentence someone can
  // act on, not a status word they have to interpret.
  const warnings: string[] = [];
  if (configured.length === 1) {
    warnings.push(`Only ${configured[0]} is keyed. A single provider means one vendor's quota or retirement takes the whole product down — which is exactly what happened when GROQ_API_KEY was removed and Gemini's free tier hit its limit.`);
  }
  if (configured.length === 0) {
    warnings.push("No provider has a key. Every generation will fail.");
  }
  for (const p of withServes) {
    if (!("probes" in p) || !p.probes) continue;
    // An override pinning a model that does not answer is invisible in a code diff and cost
    // hours today: the code default was fixed while GROQ_MODEL kept production on a retired
    // model, and the fallback quietly covered for it.
    if (p.modelOverride && p.probes.some((x) => x.model === p.modelOverride && !x.answered)) {
      warnings.push(`${p.name}: the ${p.name === "groq" ? "GROQ_MODEL" : p.name === "gemini" ? "GEMINI_MODEL" : "OPENAI_MODEL"} override pins "${p.modelOverride}", which is not answering. Delete the variable to use the tested default.`);
    }
    if (p.probes.some((x) => x.status === 429)) {
      warnings.push(`${p.name}: rate limited. The key is fine; the allowance is spent. It will recover on its own, but it cannot be relied on alone.`);
    }
  }

  return NextResponse.json({
    ok: true,
    // The one-line verdict. With ?probe=1 it means a model actually answered; without it, only
    // that a provider is keyed — which is exactly the assumption that failed today.
    healthy: deep ? anyAnswered : configured.length > 0,
    probed: deep,
    configured,
    ...(warnings.length ? { warnings } : {}),
    hint: deep
      ? undefined
      : "Add ?probe=1 to call each provider's lead model, or ?probe=all for the whole chain. A key is not proof the model exists.",
    providers: withServes,
  }, { headers: { "Cache-Control": "no-store" } });
}
