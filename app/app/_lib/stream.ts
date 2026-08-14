// Reading a generation as it arrives.
//
// The counterpart to /api/generate/stream. Kept beside ai.ts rather than inside a component
// so the two ways of asking for text sit next to each other: ai() when the code needs a
// whole answer to parse, streamAi() when a person is watching it appear.
//
// Use ai() for anything that gets parsed — a JSON profile, a routed decision. Half a JSON
// object is not a partial result, it is a syntax error. Use this only where the destination
// is someone's eyes.

export type StreamHandlers = {
  /** Called for every fragment, in order. Append; never replace. */
  onText: (chunk: string) => void;
  /** Called once at the end, with what produced it. */
  onDone?: (info: { provider: string; model: string; chars: number }) => void;
  /** Called if the answer failed or was cut short. Text already delivered stays valid. */
  onError?: (message: string) => void;
};

/**
 * Stream a completion into a callback.
 *
 * Resolves when the stream closes. Rejects only when the request itself could not be made —
 * a failure inside the stream arrives through onError, because by then there may already be
 * text on screen that should not be thrown away.
 */
export async function streamAi(
  prompt: string,
  handlers: StreamHandlers,
  opts: { url?: string; signal?: AbortSignal } = {},
): Promise<void> {
  const res = await fetch("/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, url: opts.url || null }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    // The server's hint is written for a person; the status code is not.
    throw new Error(d.hint || d.error || `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line. A partial frame at the end stays buffered until
    // the rest arrives — parsing it early is how a chunk goes missing under load.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let event: { type: string; value?: string; message?: string; provider?: string; model?: string; chars?: number };
      try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }

      if (event.type === "text" && event.value) handlers.onText(event.value);
      else if (event.type === "done") {
        handlers.onDone?.({ provider: event.provider ?? "", model: event.model ?? "", chars: event.chars ?? 0 });
      } else if (event.type === "error") {
        handlers.onError?.(event.message ?? "Something went wrong.");
      }
    }
  }
}
