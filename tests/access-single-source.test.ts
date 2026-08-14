import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// One place decides who gets in.
//
// A comped subscription was written for an account whose trial had expired. /api/generate
// let it through; the dashboard still showed "Your free month has ended", because
// /api/auth/me computed access from created_at and had never heard of subscriptions. The
// gate said yes and the screen said no, and the screen is what the person sees.
//
// That is the fifth time this week a fix landed on the instances I could see and missed one.
// This test is the class, not the instance: it fails if any route ever works out access for
// itself again.

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const routes = walk("app/api");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("access is decided in exactly one place", () => {
  it("no API route computes a trial end from created_at", () => {
    // The specific shape of the bug: created_at + TRIAL_DAYS, reimplemented per route.
    const offenders = routes.filter((f) => {
      const src = strip(readFileSync(f, "utf8"));
      return /TRIAL_DAYS/.test(src) && !/accessForUser/.test(src);
    });
    expect(offenders, `these decide access alone: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every route that gates on access asks the shared gate", () => {
    const offenders = routes.filter((f) => {
      const src = strip(readFileSync(f, "utf8"));
      return /trial_ended|isTrialActive/.test(src) && !/accessForUser/.test(src);
    });
    expect(offenders, `not using accessForUser: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the old isTrialActive is gone, not merely unused", () => {
    // Left exported, it is a loaded gun: the next person finds it, calls it, and rebuilds
    // the exact bug. lib/trial.ts now holds a note pointing at the replacement.
    const trial = readFileSync("lib/trial.ts", "utf8");
    expect(trial).not.toMatch(/export async function isTrialActive/);
    expect(trial).toMatch(/accessForUser/);
  });

  it("/api/auth/me reports the same decision the gates enforce", () => {
    // This is the one that shipped broken: it drives the lock screen.
    const me = readFileSync("app/api/auth/me/route.ts", "utf8");
    expect(me).toMatch(/accessForUser/);
    expect(me).toMatch(/active:\s*access\.allowed/);
  });
});
