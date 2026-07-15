import type { Sql } from "@/lib/db";

// Google Search Console (read-only) OAuth + Search Analytics API.
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(origin: string) {
  return origin.replace(/\/$/, "") + "/api/google/callback";
}

export function authUrl(origin: string, state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

type TokenResp = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };

export async function exchangeCode(code: string, origin: string): Promise<TokenResp> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(origin),
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return r.json();
}

async function refresh(refreshToken: string): Promise<TokenResp> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return r.json();
}

export async function ensureGoogleTable(sql: Sql) {
  await sql`CREATE TABLE IF NOT EXISTS google_tokens (
    user_id TEXT PRIMARY KEY,
    access_token TEXT,
    refresh_token TEXT,
    expiry BIGINT,
    site_url TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}

export async function saveTokens(sql: Sql, userId: string, tok: TokenResp, keepRefresh?: string) {
  const expiry = Date.now() + (tok.expires_in ?? 3600) * 1000;
  const refreshTok = tok.refresh_token ?? keepRefresh ?? null;
  await sql`
    INSERT INTO google_tokens (user_id, access_token, refresh_token, expiry)
    VALUES (${userId}, ${tok.access_token ?? null}, ${refreshTok}, ${expiry})
    ON CONFLICT (user_id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, google_tokens.refresh_token),
      expiry = EXCLUDED.expiry,
      updated_at = now()`;
}

export async function getAccessToken(sql: Sql, userId: string): Promise<string | null> {
  const rows = (await sql`SELECT access_token, refresh_token, expiry FROM google_tokens WHERE user_id = ${userId}`) as {
    access_token: string; refresh_token: string; expiry: string;
  }[];
  const t = rows[0];
  if (!t) return null;
  if (Date.now() < Number(t.expiry) - 60000) return t.access_token;
  const nt = await refresh(t.refresh_token);
  if (!nt.access_token) return null;
  await saveTokens(sql, userId, nt, t.refresh_token);
  return nt.access_token;
}

export async function isConnected(sql: Sql, userId: string) {
  const rows = (await sql`SELECT 1 FROM google_tokens WHERE user_id = ${userId}`) as unknown[];
  return rows.length > 0;
}

export async function disconnect(sql: Sql, userId: string) {
  await sql`DELETE FROM google_tokens WHERE user_id = ${userId}`;
}

export async function listSites(accessToken: string): Promise<string[]> {
  const r = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.siteEntry || [])
    .filter((s: { permissionLevel?: string }) => s.permissionLevel !== "siteUnverifiedUser")
    .map((s: { siteUrl: string }) => s.siteUrl);
}

type Row = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

export async function queryAnalytics(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[]
): Promise<Row[]> {
  const body: Record<string, unknown> = { startDate, endDate, rowLimit: 25 };
  if (dimensions.length) body.dimensions = dimensions;
  const r = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) return [];
  const d = await r.json();
  return d.rows || [];
}

export function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
