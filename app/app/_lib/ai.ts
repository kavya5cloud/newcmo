// Calling the model from the browser.
//
// Everything the dashboard generates goes through /api/generate, never straight to a
// provider: the key stays on the server, and the trial gate and rate limit are enforced
// where a client cannot skip them.


/* ---------- AI call (proxied through /api/generate) ---------- */
// Bounded so a stalled request can never freeze the flow: without a timeout an
// unresolved fetch leaves `progress` pinned, the Analyze button disabled, and the page
// sitting there forever with no error.
export const AI_TIMEOUT_MS = 60_000;

export async function ai(prompt: string, url?: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, url: url || null }),
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("timed out — the request took too long, please try again");
    }
    throw new Error("network error — check your connection and try again");
  } finally {
    clearTimeout(timer);
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const detail = [d.error, d.kind, d.provider, d.model, d.status, d.detail]
      .filter(Boolean)
      .join(" · ");
    throw new Error(detail || "api " + r.status);
  }
  return d.text as string;
}
// JSON extraction lives in lib/llm-json.ts — it repairs truncated model output and gives
// a readable error when the model replies without JSON.
export function hostOf(u: string) {
  try { return new URL(u).hostname.replace("www.", ""); } catch { return u; }
}
