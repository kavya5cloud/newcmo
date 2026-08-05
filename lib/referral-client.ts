import { normalizeCode } from "@/lib/referrals";

// Carrying a referral code from the link to the signup.
//
// Someone arrives on /?ref=ABCD2345, reads the page, pastes their website, waits for the
// analysis and only then creates an account. The code has to survive all of that, so it is
// stored the moment it is seen rather than read from the URL at signup — by which point the
// URL is long gone.

const KEY = "populr:ref";

/** Called on page load. Stores a valid code and does nothing with anything else. */
export function captureReferral(search: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const code = normalizeCode(new URLSearchParams(search).get("ref"));
    if (!code) return null;
    // First code wins. If someone lands via two different links, crediting the second would
    // quietly overwrite whoever actually brought them.
    if (!window.localStorage.getItem(KEY)) window.localStorage.setItem(KEY, code);
    return code;
  } catch {
    return null;   // private mode — the referral is lost, the signup is not
  }
}

/** The stored code, if any. Re-validated on read so stored junk cannot reach the API. */
export function readReferral(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return normalizeCode(window.localStorage.getItem(KEY)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Once credited, the code has done its job. */
export function clearReferral(): void {
  try { window.localStorage.removeItem(KEY); } catch { /* nothing to clean up */ }
}
