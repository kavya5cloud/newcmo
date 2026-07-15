import { isIP } from "node:net";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0, remaining: Math.max(0, limit - 1) };
  }

  if (current.count >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)), remaining: 0 };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0, remaining: Math.max(0, limit - current.count) };
}

export function requestKey(headers: Headers, fallback = "anon") {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || fallback;
  return ip || fallback;
}

function isPrivateIPv4(host: string) {
  const parts = host.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    (a === 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(host: string) {
  const n = host.toLowerCase();
  return n === "::1" || n.startsWith("fc") || n.startsWith("fd") || n.startsWith("fe80");
}

export function isSafePublicUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (process.env.NODE_ENV !== "production") return true;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
      return false;
    }
    if (isIP(host) === 4) return !isPrivateIPv4(host);
    if (isIP(host) === 6) return !isPrivateIPv6(host);
    return true;
  } catch {
    return false;
  }
}
