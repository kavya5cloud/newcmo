// Shared HTTP for live platform adapters.
//
// Every provider call goes through here so timeouts, error shape and redaction are decided
// once. Two rules matter:
//
//  - Never let a provider hang a publish worker. A request without a timeout can hold a job
//    in `publishing` indefinitely, and the retry logic never gets a turn.
//  - Never put a token in an error string. Errors are logged, and a leaked bearer token in a
//    log line is a real credential leak.

const DEFAULT_TIMEOUT_MS = 15_000;

export type HttpResult = {
  ok: boolean;
  status: number;
  body: unknown;
  /** Response headers we care about — LinkedIn returns the created post id in one. */
  headers: Headers | null;
  error?: string;
};

/** Strip anything token-shaped out of text that may end up in a log or a stored job error. */
export function redact(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/"(access_token|refresh_token|client_secret|code_verifier)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .replace(/(client_secret|access_token|refresh_token|code_verifier)=[^&\s]+/gi, "$1=[redacted]");
}

export async function request(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<HttpResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  try {
    const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let body: unknown = text;
    if (text) {
      try { body = JSON.parse(text); } catch { /* some endpoints answer with an empty body */ }
    }
    return { ok: res.ok, status: res.status, body, headers: res.headers };
  } catch (e) {
    // A timeout and a DNS failure are both "we never got an answer" — the job should retry
    // rather than be marked permanently failed, so this is reported as a 0 status.
    const name = e instanceof Error ? e.name : "";
    const detail = name === "TimeoutError" || name === "AbortError"
      ? `no response within ${timeoutMs}ms`
      : redact(String(e)).slice(0, 200);
    return { ok: false, status: 0, body: null, headers: null, error: detail };
  }
}

/**
 * Turn a failed provider response into one short sentence.
 *
 * Providers disagree about where the message lives: LinkedIn uses `message`, X uses `detail`
 * or an `errors[]` array, and both sometimes answer with plain text.
 */
export function describeError(r: HttpResult): string {
  if (r.error) return r.error;
  const b = r.body as Record<string, unknown> | string | null;
  if (typeof b === "string" && b.trim()) return redact(b).slice(0, 200);
  if (b && typeof b === "object") {
    const rec = b as Record<string, unknown>;
    const first = Array.isArray(rec.errors) && rec.errors.length
      ? (rec.errors[0] as Record<string, unknown>)
      : null;
    const msg =
      (typeof rec.message === "string" && rec.message) ||
      (typeof rec.detail === "string" && rec.detail) ||
      (typeof rec.error_description === "string" && rec.error_description) ||
      (typeof rec.error === "string" && rec.error) ||
      (first && typeof first.message === "string" && first.message) ||
      (first && typeof first.detail === "string" && first.detail);
    if (msg) return redact(String(msg)).slice(0, 200);
  }
  return `provider returned ${r.status}`;
}

/**
 * Whether a failure is worth retrying.
 *
 * 4xx means the request itself is wrong — retrying sends the identical bad request and
 * burns the retry budget. 429 and 5xx are the provider's problem and usually pass, and a
 * status of 0 means we never got an answer at all.
 */
export function isRetryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}
