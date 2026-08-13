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

describe("the trial message offers something that exists", () => {
  // Asserted against the hint strings rather than the file. The first version grepped the
  // whole source and failed on a comment that quoted the banned phrase while explaining why
  // it was banned — a test that cannot tell code from prose about code.
  const hints = () => {
    const route = src("app/api/generate/route.ts");
    return [...route.matchAll(/hint:\s*"([^"]+)"/g)].map((m) => m[1]);
  };

  it("does not send anyone to a checkout that was never built", () => {
    // There is no billing code in this product. A dead end is easily mistaken for a bug.
    for (const h of hints()) expect(h).not.toMatch(/upgrade/i);
  });

  it("points at referrals, which do extend the trial today", () => {
    expect(hints().some((h) => /refer 3 people/i.test(h))).toBe(true);
  });

  it("writes hints as sentences, not codes", () => {
    for (const h of hints()) expect(h.length).toBeGreaterThan(20);
  });
});
