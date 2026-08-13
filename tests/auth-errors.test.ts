import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AUTH_ERR } from "@/app/app/_components/AuthModal";

// Signing up returned 429 and the modal said "Something went wrong."
//
// rate_limited had no entry in AUTH_ERR and the auth routes sent no hint, so a limit that
// clears in seconds looked identical to being permanently blocked. The same failure — a
// server that knows the answer and a client that discards it — was fixed on /api/generate
// this morning and not carried across to auth.

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("a rate-limited signup explains itself", () => {
  it("has a message rather than falling through to 'Something went wrong'", () => {
    expect(AUTH_ERR.rate_limited).toBeTruthy();
    expect(AUTH_ERR.rate_limited.length).toBeGreaterThan(20);
  });

  it("tells the person how many seconds are left", () => {
    // "Too many attempts" without a number is indistinguishable from being blocked, so
    // people retry immediately — which extends the window they are waiting on.
    for (const route of ["app/api/auth/signup/route.ts", "app/api/auth/login/route.ts"]) {
      expect(src(route), route).toMatch(/Try again in \$\{limit\.retryAfter\}/);
    }
  });

  it("lets the server's countdown win over the static copy", () => {
    const modal = src("app/app/_components/AuthModal.tsx");
    expect(modal).toMatch(/d\.error === "rate_limited"/);
    expect(modal).toMatch(/d\.hint \|\| AUTH_ERR\.rate_limited/);
  });

  it("keeps the local wording for everything else", () => {
    // Those are better written than a generic server string.
    expect(AUTH_ERR.email_taken).toMatch(/already registered/i);
    expect(AUTH_ERR.invalid_credentials).toMatch(/wrong email or password/i);
  });

  it("writes every auth message as a sentence", () => {
    for (const [k, v] of Object.entries(AUTH_ERR)) {
      expect(v.length, `${k} is too terse`).toBeGreaterThan(15);
      expect(v, `${k} leaks a code`).not.toMatch(/^[a-z_]+$/);
    }
  });
});
