import type { Sql } from "@/lib/db";

// Early Access Program — application capture + status pipeline.
// Storing an application must NEVER fail because email isn't configured; the welcome
// email is best-effort and degrades cleanly when no provider key is set.

export const EA_STATUSES = ["new", "contacted", "accepted", "rejected"] as const;
export type EaStatus = (typeof EA_STATUSES)[number];

let eaReady = false;
export async function ensureEarlyAccessTable(sql: Sql) {
  if (eaReady) return;
  await sql`CREATE TABLE IF NOT EXISTS early_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    company TEXT,
    website TEXT,
    industry TEXT,
    marketing_challenge TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ea_created ON early_access (created_at DESC)`;
  eaReady = true;
}

export type EaInput = {
  name: string;
  email: string;
  company?: string;
  website?: string;
  industry?: string;
  marketingChallenge?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EaValidation = { ok: true; value: EaInput } | { ok: false; errors: string[] };

function clean(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

export function validateEaInput(raw: unknown): EaValidation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const name = clean(r.name, 120);
  if (!name || name.length < 2) errors.push("name");
  const email = clean(r.email, 200)?.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) errors.push("email");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: name!,
      email: email!,
      company: clean(r.company, 160),
      website: clean(r.website, 300),
      industry: clean(r.industry, 120),
      marketingChallenge: clean(r.marketingChallenge, 2000),
    },
  };
}

/** Insert an application. Idempotent on email — a repeat submit refreshes their details
 *  without creating duplicates or resetting an already-progressed status. */
export async function saveApplication(sql: Sql, input: EaInput): Promise<{ created: boolean }> {
  await ensureEarlyAccessTable(sql);
  const rows = (await sql`
    INSERT INTO early_access (name, email, company, website, industry, marketing_challenge)
    VALUES (${input.name}, ${input.email}, ${input.company ?? null}, ${input.website ?? null},
            ${input.industry ?? null}, ${input.marketingChallenge ?? null})
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      company = COALESCE(EXCLUDED.company, early_access.company),
      website = COALESCE(EXCLUDED.website, early_access.website),
      industry = COALESCE(EXCLUDED.industry, early_access.industry),
      marketing_challenge = COALESCE(EXCLUDED.marketing_challenge, early_access.marketing_challenge)
    RETURNING (xmax = 0) AS created`) as { created: boolean }[];
  return { created: !!rows[0]?.created };
}

/**
 * Best-effort welcome email via Resend (https://resend.com). Returns true if sent.
 * No key configured → returns false silently; the application is already saved, so
 * a missing email provider never blocks or errors a signup.
 */
export async function sendWelcomeEmail(name: string, email: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EARLY_ACCESS_FROM || "Populr <team@trypopulr.in>";
  if (!key) return false;
  const firstName = name.split(/\s+/)[0] || "there";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "Welcome to Populr Early Access 🚀",
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
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export type EaRow = {
  id: string;
  created_at: string;
  name: string;
  email: string;
  company: string | null;
  website: string | null;
  industry: string | null;
  marketing_challenge: string | null;
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
