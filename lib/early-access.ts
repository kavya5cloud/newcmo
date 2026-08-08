import { type Sql, RUNTIME_DDL } from "@/lib/db";
import { sendEmail } from "@/lib/services/email";

// Early Access Program — application capture + status pipeline.
// Storing an application must NEVER fail because email isn't configured; the welcome
// email is best-effort and degrades cleanly when no provider key is set.

export const EA_STATUSES = ["new", "contacted", "accepted", "rejected"] as const;
export type EaStatus = (typeof EA_STATUSES)[number];

// Interest areas offered in the Early Access modal. Kept as a closed set so the
// stored `interests` array is always a clean, queryable enum.
export const EA_INTERESTS = [
  "launch_videos",
  "ugc_videos",
  "motion_graphics",
  "ai_creative_studio",
  "ai_campaigns",
] as const;
export type EaInterest = (typeof EA_INTERESTS)[number];

let eaReady = false;
export async function ensureEarlyAccessTable(sql: Sql) {
  if (eaReady) return;
  if (!RUNTIME_DDL) { eaReady = true; return; }
  await sql`CREATE TABLE IF NOT EXISTS early_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    name TEXT,
    email TEXT NOT NULL UNIQUE,
    company TEXT,
    website TEXT,
    industry TEXT,
    marketing_challenge TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT
  )`;
  // Milestone 5 columns (migration 20260719 owns these in prod; mirrored here for dev/test).
  await sql`ALTER TABLE early_access ALTER COLUMN name DROP NOT NULL`;
  await sql`ALTER TABLE early_access ADD COLUMN IF NOT EXISTS team_size TEXT`;
  await sql`ALTER TABLE early_access ADD COLUMN IF NOT EXISTS project TEXT`;
  await sql`ALTER TABLE early_access ADD COLUMN IF NOT EXISTS interests JSONB NOT NULL DEFAULT '[]'::jsonb`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ea_created ON early_access (created_at DESC)`;
  eaReady = true;
}

export type EaInput = {
  name?: string;
  email: string;
  company?: string;
  website?: string;
  industry?: string;
  marketingChallenge?: string;
  teamSize?: string;
  project?: string;
  interests: EaInterest[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EaValidation = { ok: true; value: EaInput } | { ok: false; errors: string[] };

function clean(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function cleanInterests(v: unknown): EaInterest[] {
  if (!Array.isArray(v)) return [];
  const allowed = new Set<string>(EA_INTERESTS);
  return [...new Set(v.map((x) => String(x)).filter((x) => allowed.has(x)))] as EaInterest[];
}

export function validateEaInput(raw: unknown): EaValidation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  // Work email is the only required field in the new modal. Name is optional now
  // (the legacy /early-access page still sends it, which stays valid).
  const email = clean(r.email, 200)?.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) errors.push("email");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: clean(r.name, 120),
      email: email!,
      company: clean(r.company, 160),
      website: clean(r.website, 300),
      industry: clean(r.industry, 120),
      marketingChallenge: clean(r.marketingChallenge, 2000),
      teamSize: clean(r.teamSize, 60),
      project: clean(r.project ?? r.marketingChallenge, 2000),
      interests: cleanInterests(r.interests),
    },
  };
}

/** Insert an application. Idempotent on email — a repeat submit refreshes their details
 *  without creating duplicates or resetting an already-progressed status. */
export async function saveApplication(sql: Sql, input: EaInput): Promise<{ created: boolean }> {
  await ensureEarlyAccessTable(sql);
  const rows = (await sql`
    INSERT INTO early_access (name, email, company, website, industry, marketing_challenge, team_size, project, interests)
    VALUES (${input.name ?? null}, ${input.email}, ${input.company ?? null}, ${input.website ?? null},
            ${input.industry ?? null}, ${input.marketingChallenge ?? null}, ${input.teamSize ?? null},
            ${input.project ?? null}, ${JSON.stringify(input.interests ?? [])}::jsonb)
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, early_access.name),
      company = COALESCE(EXCLUDED.company, early_access.company),
      website = COALESCE(EXCLUDED.website, early_access.website),
      industry = COALESCE(EXCLUDED.industry, early_access.industry),
      marketing_challenge = COALESCE(EXCLUDED.marketing_challenge, early_access.marketing_challenge),
      team_size = COALESCE(EXCLUDED.team_size, early_access.team_size),
      project = COALESCE(EXCLUDED.project, early_access.project),
      -- keep whichever interest set is non-empty; a repeat submit shouldn't wipe prior picks
      interests = CASE WHEN jsonb_array_length(EXCLUDED.interests) > 0 THEN EXCLUDED.interests ELSE early_access.interests END
    RETURNING (xmax = 0) AS created`) as { created: boolean }[];
  return { created: !!rows[0]?.created };
}

/**
 * Best-effort welcome email through the active email provider (see lib/services/email.ts).
 * Returns true if sent. No provider configured → returns false silently; the application
 * is already saved, so a missing email provider never blocks or errors a signup.
 */
export async function sendWelcomeEmail(name: string | undefined, email: string): Promise<boolean> {
  const firstName = (name || "").split(/\s+/)[0] || "there";
  const res = await sendEmail({
    to: email,
    subject: "Welcome to Populr Early Access",
    text:
`Hi ${firstName},

Thank you for joining the Populr Early Access Program — you're among the very first people getting access.

Populr is an AI CMO: it decides what marketing is actually worth doing for your business, plans the campaigns, drafts the assets, and measures what worked — so you spend your time on the few things that move your numbers.

As an early member you'll get:
• Early feature releases before public launch
• A direct channel to shape the roadmap
• Exclusive product updates and previews

We'll be in touch soon with your access. Reply to this email any time — we read everything.

— The Populr team
https://www.trypopulr.in`,
  });
  return res.sent;
}

export type EaRow = {
  id: string;
  created_at: string;
  name: string | null;
  email: string;
  company: string | null;
  website: string | null;
  industry: string | null;
  marketing_challenge: string | null;
  team_size: string | null;
  project: string | null;
  interests: string[];
  status: string;
  notes: string | null;
};

export async function listApplications(sql: Sql): Promise<EaRow[]> {
  await ensureEarlyAccessTable(sql);
  return (await sql`SELECT * FROM early_access ORDER BY created_at DESC LIMIT 1000`) as EaRow[];
}

export async function setApplicationStatus(sql: Sql, id: string, status: EaStatus, notes?: string): Promise<boolean> {
  await ensureEarlyAccessTable(sql);
  const rows = (await sql`
    UPDATE early_access
    SET status = ${status}, notes = COALESCE(${notes ?? null}, notes)
    WHERE id = ${id}
    RETURNING id`) as { id: string }[];
  return rows.length > 0;
}
