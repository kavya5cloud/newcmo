import { neon } from "@neondatabase/serverless";

export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

export type Sql = NonNullable<ReturnType<typeof db>>;

// In production, schema is owned by migrations (npm run db:migrate) and request-time DDL
// is disabled with SKIP_RUNTIME_DDL=true. In dev/test the ensure* guards still create
// tables on first use so the app runs without a manual migrate step. Either way the DDL
// is idempotent (IF NOT EXISTS) and each ensure* runs at most once per process.
export const RUNTIME_DDL = process.env.SKIP_RUNTIME_DDL !== "true";

let schemaReady = false;
export async function ensureSchema(sql: Sql) {
  if (schemaReady) return;
  if (!RUNTIME_DDL) { schemaReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS workspaces (
    wsid TEXT PRIMARY KEY,
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // Referrals. referred_user_id is the primary key, not a plain column: one account can be
  // credited to exactly one referrer, exactly once, enforced by the database rather than by
  // remembering to check. A replayed signup cannot mint a second month.
  await sql`CREATE TABLE IF NOT EXISTS referrals (
    referred_user_id TEXT PRIMARY KEY,
    referrer_id TEXT NOT NULL,
    code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A signup alone is not worth a free month: without email verification anyone can make
    -- one in seconds. The row is written at signup so the link is not lost, but it only
    -- counts towards a reward once the account does something real.
    qualified_at TIMESTAMPTZ
  )`;
  await sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ`;
  await sql`CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON referrals (referrer_id)`;
  schemaReady = true;
}
