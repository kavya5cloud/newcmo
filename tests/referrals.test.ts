import { describe, expect, it } from "vitest";
import {
  REFERRALS_PER_REWARD, REWARD_DAYS, canCredit, codeForUser, describeProgress,
  normalizeCode, progressFor, shareLink,
} from "@/lib/referrals";

// A referral programme grants real money's worth of product, so the parts worth pinning down
// are the ones that decide who gets paid: the maths, and the rules that stop it being farmed.

describe("referral codes", () => {
  it("are stable for a user, forever", () => {
    // Codes get shared, printed, and pasted months later. One that changed would silently
    // stop crediting the person who earned it.
    expect(codeForUser("user-1")).toBe(codeForUser("user-1"));
  });

  it("differ between users", () => {
    const codes = new Set(Array.from({ length: 200 }, (_, i) => codeForUser(`user-${i}`)));
    expect(codes.size).toBe(200);
  });

  it("avoid characters that get misread when typed or read aloud", () => {
    for (let i = 0; i < 300; i++) {
      const c = codeForUser(`u${i}`);
      expect(c).toHaveLength(8);
      expect(c).not.toMatch(/[01OIL]/);
      expect(c).toMatch(/^[2-9A-HJ-NP-Z]+$/);
    }
  });
});

describe("accepting a code however it arrives", () => {
  const code = codeForUser("user-1");

  it("takes it from a full share link", () => {
    expect(normalizeCode(shareLink("https://www.trypopulr.in", code))).toBe(code);
  });

  it("forgives case, spaces and dashes", () => {
    const messy = ` ${code.toLowerCase().slice(0, 4)}-${code.toLowerCase().slice(4)} `;
    expect(normalizeCode(messy)).toBe(code);
  });

  it("rejects anything that could not be a real code", () => {
    expect(normalizeCode("")).toBeNull();
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode("ABCD2345")).not.toBeNull();      // 8 chars, all in the alphabet
    expect(normalizeCode("SHORT")).toBeNull();             // wrong length
    expect(normalizeCode("ABCD23456")).toBeNull();         // too long
    expect(normalizeCode("ABCD0345")).toBeNull();          // 0 is excluded
    expect(normalizeCode("TOOSHORT")).toBeNull();          // contains O, which is excluded
    expect(normalizeCode("<script>x")).toBeNull();
  });
});

describe("what a referral earns", () => {
  it("gives nothing until the threshold is reached", () => {
    for (let n = 0; n < REFERRALS_PER_REWARD; n++) {
      expect(progressFor(n).bonusDays).toBe(0);
      expect(progressFor(n).rewards).toBe(0);
    }
  });

  it("gives a month at exactly three", () => {
    const p = progressFor(REFERRALS_PER_REWARD);
    expect(p.rewards).toBe(1);
    expect(p.bonusDays).toBe(REWARD_DAYS);
  });

  it("keeps rewarding past the first, rather than stopping", () => {
    // Someone who brings six people earned two months. A programme that quietly stops
    // counting teaches people it was a gimmick.
    expect(progressFor(6).bonusDays).toBe(2 * REWARD_DAYS);
    expect(progressFor(9).rewards).toBe(3);
  });

  it("counts down to the next reward, never to zero", () => {
    expect(progressFor(0).toNextReward).toBe(3);
    expect(progressFor(1).toNextReward).toBe(2);
    expect(progressFor(2).toNextReward).toBe(1);
    // Just earned one — the next is a full three away, not zero.
    expect(progressFor(3).toNextReward).toBe(3);
    expect(progressFor(4).toNextReward).toBe(2);
  });

  it("cannot be talked into a negative or fractional reward", () => {
    expect(progressFor(-5).bonusDays).toBe(0);
    expect(progressFor(2.9).rewards).toBe(0);
    expect(progressFor(3.9).rewards).toBe(1);
  });
});

describe("who may be credited", () => {
  it("credits a genuine referral", () => {
    expect(canCredit({ referrerId: "a", newUserId: "b", alreadyCredited: false })).toEqual({ ok: true });
  });

  it("refuses a self-referral", () => {
    // The first thing anyone tries.
    const r = canCredit({ referrerId: "a", newUserId: "a", alreadyCredited: false });
    expect(r).toEqual({ ok: false, reason: "self_referral" });
  });

  it("refuses to credit the same account twice", () => {
    const r = canCredit({ referrerId: "a", newUserId: "b", alreadyCredited: true });
    expect(r).toEqual({ ok: false, reason: "already_credited" });
  });

  it("refuses a code that belongs to nobody", () => {
    const r = canCredit({ referrerId: null, newUserId: "b", alreadyCredited: false });
    expect(r).toEqual({ ok: false, reason: "unknown_code" });
  });
});

describe("what the panel says", () => {
  it("invites rather than reports when nothing has happened", () => {
    expect(describeProgress(progressFor(0))).toBe("Refer 3 people and get another month free.");
  });

  it("never claims a reward that has not been earned", () => {
    const s = describeProgress(progressFor(2));
    expect(s).toContain("2 joined");
    expect(s).toContain("1 more");
    expect(s).not.toMatch(/earned/);
  });

  it("says what has been earned once it has", () => {
    expect(describeProgress(progressFor(3))).toContain("1 free month");
    expect(describeProgress(progressFor(6))).toContain("2 free months");
  });
});

describe("the share link", () => {
  it("is a normal landing-page URL with the code attached", () => {
    expect(shareLink("https://www.trypopulr.in", "ABCD2345")).toBe("https://www.trypopulr.in/?ref=ABCD2345");
  });

  it("does not double the slash", () => {
    expect(shareLink("https://www.trypopulr.in/", "ABCD2345")).toBe("https://www.trypopulr.in/?ref=ABCD2345");
  });

  it("round-trips back to the same code", () => {
    const code = codeForUser("someone");
    expect(normalizeCode(shareLink("https://www.trypopulr.in", code))).toBe(code);
  });
});
