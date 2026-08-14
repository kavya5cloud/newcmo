import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Streaming generation.
//
// Everything else waits for a complete response then shows it — correct for anything the
// code parses, wrong for anything a person reads. Twenty seconds of nothing followed by four
// paragraphs feels broken; twenty seconds of arriving text does not. Same duration, and only
// one of them is bearable.

const strip = (s: string) =>
  s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const src = (p: string) => strip(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

describe("fallback happens before the first byte, never after", () => {
  const stream = () => src("lib/services/llm-stream.ts");

  it("moves to the next model when a stream fails to open", () => {
    // Nothing has reached the browser yet, so trying another provider costs nothing.
    expect(stream()).toMatch(/if \(!res\?\.body\) continue/);
  });

  it("still moves on when a provider opens but says nothing", () => {
    expect(stream()).toMatch(/if \(chars === 0\) continue/);
  });

  it("does not silently switch provider once text is on screen", () => {
    // Switching mid-stream means replaying from the start or splicing two answers together.
    // Neither is honest, so the stream ends and says it was cut off.
    const s = stream();
    expect(s).toMatch(/cut off/i);
    expect(s).toMatch(/if \(chars === 0\) continue;\s+yield \{ type: "error"/);
  });
});

describe("what the stream refuses to do", () => {
  it("never caches a streamed answer", () => {
    // The cache stores complete answers. A truncated stream is not one, and serving half an
    // answer later as a whole one is worse than serving a slow answer now.
    expect(src("lib/services/llm-stream.ts")).not.toMatch(/putCachedAnalysis|cacheKey/);
  });

  it("reports truncation rather than ending mid-sentence", () => {
    // The non-streaming path treats truncation as failure and retries another model. There
    // is no such option here, so the honest move is to say so.
    expect(src("lib/services/llm-stream.ts")).toMatch(/MAX_TOKENS/);
    expect(src("lib/services/llm-stream.ts")).toMatch(/length limit/i);
  });

  it("skips models already known to be dead", () => {
    expect(src("lib/services/llm.ts")).toMatch(/deadModels\.has\(deadKey\(provider\.name, m\)\)/);
  });
});

describe("the streaming route is gated exactly like the blocking one", () => {
  const route = () => src("app/api/generate/stream/route.ts");

  it("checks rate limit, access and URL safety", () => {
    // A streaming endpoint that skips these is the old endpoint with the checks removed.
    for (const guard of ["rateLimit", "accessForUser", "isSafePublicUrl"]) {
      expect(route(), `missing ${guard}`).toMatch(new RegExp(guard));
    }
  });

  it("caps prompt length like the blocking route", () => {
    expect(route()).toMatch(/10_000/);
  });

  it("tells proxies not to buffer, or streaming achieves nothing", () => {
    // Some proxies hold the whole response and deliver it at the end — precisely the
    // behaviour this route exists to avoid.
    expect(route()).toMatch(/X-Accel-Buffering/);
    expect(route()).toMatch(/text\/event-stream/);
  });

  it("always closes the stream, so no client is left holding an open socket", () => {
    expect(route()).toMatch(/finally \{\s*controller\.close\(\)/);
  });
});

describe("the client", () => {
  const client = () => src("app/app/_lib/stream.ts");

  it("buffers partial frames instead of parsing them early", () => {
    // Parsing a half-arrived frame is how a chunk goes missing under load.
    expect(client()).toMatch(/frames\.pop\(\)/);
  });

  it("keeps text already delivered when the stream errors", () => {
    // Rejecting would throw away what is already on screen and readable.
    expect(client()).toMatch(/onError/);
  });

  it("surfaces the server's hint rather than a status code", () => {
    expect(client()).toMatch(/d\.hint \|\| d\.error/);
  });
});
