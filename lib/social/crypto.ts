import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Secure encrypted token storage — AES-256-GCM. Access/refresh tokens are NEVER stored or
// returned in plaintext. The key derives from SOCIAL_TOKEN_KEY (falls back to a per-process
// dev key so the system still runs locally; production must set the env var).

export type Sealed = { ciphertext: string; iv: string; tag: string };

let devKey: Buffer | null = null;
let warnedAboutDevKey = false;

function key(): Buffer {
  const secret = process.env.SOCIAL_TOKEN_KEY;
  if (secret) return createHash("sha256").update(secret).digest();

  // Running on the dev key in production means every token sealed now becomes unreadable
  // the moment SOCIAL_TOKEN_KEY is finally set — which is exactly how a fleet of accounts
  // ends up asking to be reconnected at once. Say so loudly, once.
  if (process.env.NODE_ENV === "production" && !warnedAboutDevKey) {
    warnedAboutDevKey = true;
    console.warn(JSON.stringify({
      event: "social_token_key_missing",
      detail: "SOCIAL_TOKEN_KEY is unset in production; tokens are sealed with the dev key and will not survive setting it.",
    }));
  }
  if (!devKey) devKey = createHash("sha256").update("populr-dev-social-token-key").digest();
  return devKey;
}

/**
 * Thrown when a token cannot be decrypted with the current key.
 *
 * Node reports this as "Unsupported state or unable to authenticate data", which says
 * nothing about the cause. In practice there is only one: the token was sealed under a
 * different SOCIAL_TOKEN_KEY than the one loaded now — typically because the variable was
 * set after accounts had already been connected. No amount of retrying fixes it and the
 * plaintext is not recoverable; the account has to be reconnected. Naming that here is the
 * difference between a five-minute fix and an afternoon.
 */
export class TokenKeyMismatchError extends Error {
  readonly code = "token_key_mismatch";
  constructor() {
    super("Stored token cannot be decrypted with the current SOCIAL_TOKEN_KEY. It was sealed with a different key — reconnect the account.");
    this.name = "TokenKeyMismatchError";
  }
}

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function open(sealed: Sealed): string {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // GCM authentication failed. The ciphertext is intact — the key is wrong.
    throw new TokenKeyMismatchError();
  }
}

/** Mask a token for structured logs — never log the real value. */
export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-2)}`;
}
