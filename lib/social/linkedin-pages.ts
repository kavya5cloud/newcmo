import { request } from "./http";

// The Company Pages a member can post as.
//
// Someone connecting LinkedIn "for their business" almost always means their Page, not their
// own profile — but LinkedIn only tells you which Pages they administer if you ask, and the
// answer is frequently more than one. So: fetch the list, let them choose, store the choice.
//
// Everything here degrades to the personal feed rather than failing. Organization posting
// requires LinkedIn's Community Management API, which is granted per-app through their
// developer portal and takes review time; until that lands the scopes are simply not granted
// and this returns an empty list. An empty list is a normal state, not an error.

export type LinkedInPage = {
  /** Numeric organization id — becomes urn:li:organization:{id} at publish time. */
  id: string;
  name: string;
};

const API = "https://api.linkedin.com/rest";

function headers(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "LinkedIn-Version": "202401",
    "X-Restli-Protocol-Version": "2.0.0",
  };
}

/** Pull the organization id out of "urn:li:organization:12345". */
export function organizationIdFromUrn(urn: string): string | null {
  const m = /^urn:li:organization:(\d+)$/.exec((urn || "").trim());
  return m ? m[1] : null;
}

/**
 * Pages this member administers.
 *
 * Two calls, because LinkedIn splits them: the ACL endpoint says which organizations the
 * member has a role on, and a second lookup turns those ids into names. Without the names
 * the chooser would show a list of numbers, which is not a choice anyone can make.
 *
 * Returns [] on any failure. A founder who cannot post as a Page should land on the personal
 * feed with an explanation, not on an error page — the connection itself is still good.
 */
export async function listAdministeredPages(accessToken: string): Promise<LinkedInPage[]> {
  const acl = await request(
    `${API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organization~(id,localizedName)))`,
    { method: "GET", headers: headers(accessToken) },
  );
  if (!acl.ok) return [];

  const body = acl.body as { elements?: unknown[] } | null;
  const elements = Array.isArray(body?.elements) ? body!.elements : [];

  const pages: LinkedInPage[] = [];
  for (const el of elements) {
    const row = el as Record<string, unknown>;
    // The projection inlines the organization under "organization~"; fall back to the raw
    // urn when LinkedIn returns the unprojected shape.
    const inlined = row["organization~"] as { id?: unknown; localizedName?: unknown } | undefined;
    const id = inlined?.id != null ? String(inlined.id) : organizationIdFromUrn(String(row.organization ?? ""));
    if (!id) continue;
    const name = typeof inlined?.localizedName === "string" && inlined.localizedName.trim()
      ? inlined.localizedName.trim()
      : `Company page ${id}`;
    if (!pages.some((p) => p.id === id)) pages.push({ id, name });
  }
  return pages;
}

/**
 * Whether this connection was actually granted Page posting.
 *
 * Checked against the granted scopes rather than the requested ones. Asking for a scope and
 * receiving it are different events, and the difference here is the whole feature — an
 * account that believes it can post as a Page and cannot fails at publish time with a
 * permissions error that explains nothing.
 */
export function canPostAsPage(grantedScopes: string[]): boolean {
  return grantedScopes.includes("w_organization_social");
}
