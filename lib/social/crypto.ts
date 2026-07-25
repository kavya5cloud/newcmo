import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Secure encrypted token storage — AES-256-GCM. Access/refresh tokens are NEVER stored or
// returned in plaintext. The key derives from SOCIAL_TOKEN_KEY (falls back to a per-process
// dev key so the system still runs locally; production must set the env var).

export type Sealed = { ciphertext: string; iv: string; tag: string };

let devKey: Buffer | null = null;
function key(): Buffer {
  const secret = process.env.SOCIAL_TOKEN_KEY;
  if (secret) return createHash("sha256").update(secret).digest();
  if (!devKey) devKey = createHash("sha256").update("populr-dev-social-token-key").digest();
  return devKey;
}

export function seal(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ct.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

export function open(sealed: Sealed): string {
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** Mask a token for structured logs — never log the real value. */
export function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}…${token.slice(-2)}`;
}
