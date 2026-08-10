import { describe, expect, it } from "vitest";
import { canPostAsPage, organizationIdFromUrn } from "@/lib/social/linkedin-pages";
import { liveScopes } from "@/lib/social/oauth-live";

// Where a LinkedIn post actually lands.
//
// The adapter hardcoded `urn:li:person:{id}`, so every post went to the connecting person's
// own profile with no way to say otherwise. Someone connecting LinkedIn "for their business"
// almost always means their Company Page, and finding an AI-scheduled post on their personal
// profile instead is a surprise nobody forgives twice.

describe("the publish target is data, not an assumption", () => {
  it("asks for the scopes Page posting needs", () => {
    const s = liveScopes("linkedin");
    expect(s).toContain("w_organization_social");   // post as the Page
    expect(s).toContain("r_organization_admin");    // find which Pages they administer
  });

  it("keeps the member scope, since the personal feed is still the fallback", () => {
    expect(liveScopes("linkedin")).toContain("w_member_social");
  });

  it("only claims Page posting when the scope was actually granted", () => {
    // Requesting a scope and receiving it are different events. LinkedIn withholds the
    // organization scopes until the app clears Community Management review, and an account
    // that believes it can post as a Page but cannot fails at publish time with a
    // permissions error that explains nothing.
    expect(canPostAsPage(["openid", "profile", "w_member_social"])).toBe(false);
    expect(canPostAsPage(["w_member_social", "w_organization_social"])).toBe(true);
  });

  it("reads an organization id out of its urn", () => {
    expect(organizationIdFromUrn("urn:li:organization:12345")).toBe("12345");
  });

  it("refuses urns that are not organizations", () => {
    // A person urn reaching the organization path would post to the wrong place entirely.
    expect(organizationIdFromUrn("urn:li:person:abc")).toBe(null);
    expect(organizationIdFromUrn("")).toBe(null);
    expect(organizationIdFromUrn("urn:li:organization:")).toBe(null);
  });
});

describe("the adapter honours the stored target", () => {
  const src = () => import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../lib/social/adapters-live.ts", import.meta.url), "utf8"));

  it("posts as the organization when one was chosen", async () => {
    expect(await src()).toMatch(/urn:li:organization:\$\{token\.organizationId\}/);
  });

  it("still falls back to the person when none was", async () => {
    expect(await src()).toMatch(/urn:li:person:\$\{token\.externalId\}/);
  });
});
