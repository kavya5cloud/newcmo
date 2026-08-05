import { createHash } from "node:crypto";

// Refer three people, get another month.
//
// The reward is never stored as a number. It is derived from the referral rows every time it
// is read, so a bug or a replayed request cannot leave someone with months they did not
// earn — and cannot quietly take away months they did. The rows are the truth; the months
// are a view of them.

/** Referrals needed per free month. */
export const REFERRALS_PER_REWARD = 3;

/** Days granted each time that threshold is crossed. */
export const REWARD_DAYS = 30;

/**
 * Referral codes.
 *
 * Derived from the user id rather than stored, so a code is stable forever and there is no
 * table to keep in step. Ambiguous characters are excluded because these get typed by hand
 * and read aloud — 0/O and 1/I/L cause more support mail than they are worth.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

export function codeForUser(userId: string): string {
  const digest = createHash("sha256").update(`populr-referral:${userId}`).digest();
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[digest[i] % ALPHABET.length];
  return out;
}

/** Accept a code however it was pasted — spaces, dashes, lower case, a whole share link. */
export function normalizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // A pasted share link carries the code in ?ref=, so the query string is the part that
  // matters — an earlier version stripped it and could never read its own links.
  let candidate = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      candidate = new URL(trimmed).searchParams.get("ref") ?? "";
    } catch {
      return null;
    }
  }

  const cleaned = candidate.replace(/[\s-]/g, "").toUpperCase();
  if (cleaned.length !== CODE_LENGTH) return null;
  // Reject anything containing a character the alphabet never produces, so a typo fails
  // fast rather than becoming a lookup for a code that cannot exist.
  for (const ch of cleaned) if (!ALPHABET.includes(ch)) return null;
  return cleaned;
}

// ---- The reward ----

export type ReferralProgress = {
  /** Accounts that signed up with this user's code. */
  referred: number;
  /** Whole rewards earned so far. */
  rewards: number;
  /** Extra trial days earned. */
  bonusDays: number;
  /** How many more sign-ups until the next free month. */
  toNextReward: number;
};

/**
 * Progress from a count of referrals.
 *
 * Deliberately keeps rewarding past the first three: someone who brings six people has
 * earned two months, and a programme that silently stops counting after the first reward
 * teaches people it was a one-off gimmick.
 */
export function progressFor(referred: number): ReferralProgress {
  const count = Math.max(0, Math.floor(referred));
  const rewards = Math.floor(count / REFERRALS_PER_REWARD);
  const remainder = count % REFERRALS_PER_REWARD;
  return {
    referred: count,
    rewards,
    bonusDays: rewards * REWARD_DAYS,
    toNextReward: REFERRALS_PER_REWARD - remainder,
  };
}

/** The line shown on screen. Plain, and never claims a reward that has not been earned. */
export function describeProgress(p: ReferralProgress): string {
  if (p.referred === 0) return `Refer ${REFERRALS_PER_REWARD} people and get another month free.`;
  if (p.rewards === 0) {
    return `${p.referred} joined. ${p.toNextReward} more for a free month.`;
  }
  const months = p.rewards === 1 ? "1 free month" : `${p.rewards} free months`;
  return `${p.referred} joined — ${months} earned. ${p.toNextReward} more for the next.`;
}

/** Whether a referral may be credited. Kept pure so the rules are readable in one place. */
export function canCredit(opts: {
  referrerId: string | null;
  newUserId: string;
  alreadyCredited: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!opts.referrerId) return { ok: false, reason: "unknown_code" };
  // Referring yourself is the first thing anyone tries.
  if (opts.referrerId === opts.newUserId) return { ok: false, reason: "self_referral" };
  // One credit per account, ever — not per signup attempt, not per session.
  if (opts.alreadyCredited) return { ok: false, reason: "already_credited" };
  return { ok: true };
}

/** The link a user shares. */
export function shareLink(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/?ref=${code}`;
}
