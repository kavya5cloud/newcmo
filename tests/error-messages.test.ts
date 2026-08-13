import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// What a founder sees when something fails.
//
// Entering a website and having nothing happen was reported as the product being broken. The
// code path was fine; the account's free month had ended, and the client rendered the
// failure as "trial_ended · 402" in a toast. A raw code in a toast is indistinguishable from
// a crash, so a working gate looked like a bug.

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("the server's hint reaches the person", () => {
  it("the client prefers hint over joining diagnostic codes", () => {
    const ai = src("app/app/_lib/ai.ts");
    const hintIndex = ai.indexOf("d.hint");
    const joinIndex = ai.indexOf("[d.error, d.kind");
    expect(hintIndex).toBeGreaterThan(-1);
    // The hint branch has to come first, or the codes win.
    expect(hintIndex).toBeLessThan(joinIndex);
  });

  it("still shows something when there is no hint", () => {
    // A raw code beats an empty toast.
    expect(src("app/app/_lib/ai.ts")).toMatch(/api " \+ r\.status/);
  });

  it("every failure path in /api/generate carries a hint", () => {
    const route = src("app/api/generate/route.ts");
    const errors = route.match(/error: "[a-z_]+"/g) || [];
    const hints = route.match(/hint:/g) || [];
    expect(errors.length).toBeGreaterThan(3);
    expect(hints.length).toBeGreaterThanOrEqual(errors.length - 1);   // one shared error branch
  });
});

describe("a refusal offers something the person can actually do", () => {
  // These messages moved out of the route and into lib/billing/access.ts when subscriptions
  // arrived, because "why is this account blocked" is now a real decision rather than one
  // date comparison. Asserted where they live.
  const messages = () => {
    const src2 = src("lib/billing/access.ts");
    return [...src2.matchAll(/^\s+\w+:\s*"([^"]{10,})",?$/gm)].map((m) => m[1]);
  };

  it("names a route out of every dead end", () => {
    const all = messages().join(" ");
    // Subscribing and referrals both exist now; either is a real way forward.
    expect(all).toMatch(/subscribe/i);
    expect(all).toMatch(/refer 3 people/i);
    expect(all).toMatch(/card/i);
  });

  it("writes them as sentences, not codes", () => {
    for (const m of messages()) expect(m.length).toBeGreaterThan(20);
  });

  it("still carries hints on the generate route's own failures", () => {
    const route = src("app/api/generate/route.ts");
    const hints = [...route.matchAll(/hint:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(hints.length).toBeGreaterThan(2);
    for (const h of hints) expect(h.length).toBeGreaterThan(20);
  });
});
