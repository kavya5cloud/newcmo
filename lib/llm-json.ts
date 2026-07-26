// Robust JSON extraction from model output.
//
// Models return JSON wrapped in prose, fenced in markdown, or — most commonly — TRUNCATED
// when they hit the output-token cap mid-object. The naive `indexOf("{") … lastIndexOf("}")`
// approach breaks on all three: a truncated object's last `}` belongs to a NESTED object,
// so the slice is invalid JSON, and a prose-only reply yields `JSON.parse("")` →
// "Unexpected end of JSON input", which tells the user nothing.
//
// This module scans with real string/escape awareness, and repairs truncation by closing
// what's still open. Pure + deterministic, so it's unit-tested.

export class LlmJsonError extends Error {
  constructor(message: string, readonly reason: "no_json" | "unparseable", readonly sample: string) {
    super(message);
    this.name = "LlmJsonError";
  }
}

/** Strip markdown fences and common leading labels. */
function stripFences(text: string): string {
  return text
    .replace(/```(?:json|JSON)?/g, "")
    .replace(/^\s*(?:json|JSON)\s*:?\s*/, "")
    .trim();
}

type Scan = { end: number; complete: boolean; depth: number; stack: string[]; inString: boolean };

/** Scan from `start` tracking strings/escapes; report where the value ends and whether it closed. */
function scan(s: string, start: number): Scan {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") {
      stack.pop();
      if (stack.length === 0) return { end: i + 1, complete: true, depth: 0, stack, inString };
    }
  }
  return { end: s.length, complete: false, depth: stack.length, stack, inString };
}

/**
 * Repair a truncated JSON fragment: close the open string, drop the incomplete trailing
 * member, then close every still-open container.
 *
 * Only the INNERMOST container can be incomplete (truncation cuts the tail), so trimming
 * is done against that container's type: inside an object a trailing bare string is a
 * partial key and must go, whereas inside an array the same text is a complete element
 * and must be kept.
 */
function repairTruncated(fragment: string, sc: Scan): string {
  let out = fragment;

  // 1. Close a string that was cut mid-value.
  if (sc.inString) out += '"';

  const innermost = sc.stack[sc.stack.length - 1];

  // 2. Trim the incomplete trailing member, repeating until stable.
  for (let guard = 0; guard < 5; guard++) {
    const before = out;
    out = out.replace(/,\s*$/, "");                       // trailing comma
    out = out.replace(/,?\s*"[^"]*"\s*:\s*$/, "");        // `"key":` with no value
    if (innermost === "{") {
      out = out.replace(/,\s*"[^"]*"\s*$/, "");           // partial key, no colon yet
      out = out.replace(/(\{)\s*"[^"]*"\s*$/, "$1");      // partial key as the only member
    }
    out = out.replace(/,\s*[{[]\s*$/, "");                // empty trailing container
    if (out === before) break;
  }

  // 3. Close everything still open, innermost first.
  for (let i = sc.stack.length - 1; i >= 0; i--) out += sc.stack[i] === "{" ? "}" : "]";
  return out;
}

/** Remove trailing commas before a closing brace/bracket (models emit these often). */
function dropTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Extract and parse the first complete JSON value from model output.
 * Repairs truncation and tolerates fences/prose. Throws LlmJsonError with a useful
 * message (and a sample of what came back) when there is genuinely no JSON.
 */
export function extractJson<T = Record<string, unknown>>(text: string): T {
  const raw = typeof text === "string" ? text : "";
  const clean = stripFences(raw);

  // Find the first plausible JSON opener.
  const objAt = clean.indexOf("{");
  const arrAt = clean.indexOf("[");
  const candidates = [objAt, arrAt].filter((i) => i >= 0);
  if (candidates.length === 0) {
    throw new LlmJsonError(
      "the model replied without any JSON",
      "no_json",
      clean.slice(0, 200),
    );
  }
  const start = Math.min(...candidates);

  const sc = scan(clean, start);
  const fragment = clean.slice(start, sc.end);

  const attempts = sc.complete
    ? [fragment, dropTrailingCommas(fragment)]
    : [repairTruncated(fragment, sc), dropTrailingCommas(repairTruncated(fragment, sc))];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as T;
    } catch {
      // try the next repair strategy
    }
  }

  throw new LlmJsonError(
    sc.complete ? "the model returned malformed JSON" : "the model's reply was cut off before the JSON finished",
    "unparseable",
    fragment.slice(0, 200),
  );
}

/** Non-throwing variant. */
export function tryExtractJson<T = Record<string, unknown>>(text: string): T | null {
  try {
    return extractJson<T>(text);
  } catch {
    return null;
  }
}
