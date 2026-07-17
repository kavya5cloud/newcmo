import { getSession } from "@/lib/auth";

// Admin gate: a comma-separated ADMIN_EMAILS allowlist. The signed-in session email
// (server-derived, unspoofable) must be on it. No env set → no admins (fail closed).
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  const allow = adminEmails();
  return allow.includes(session.email.toLowerCase());
}
