import { describe, expect, it } from "vitest";
import { tierOf, can, upgradeMessage, featuresOf } from "@/lib/billing/plans";
import type { Subscription } from "@/lib/billing/access";

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  userId: "u1", status: "active", currentPeriodEnd: null, externalId: "x",
  productId: null, updatedAt: 0, ...over,
} as Subscription);

describe("tiers come from what was bought", () => {
  it("gives no subscription the free tier", () => {
    expect(tierOf(null)).toBe("free");
  });

  it("treats a paid subscription as starter when no pro product is configured", () => {
    // Until a second product exists in Polar there is nothing to sell, so everyone paying is
    // on the plan they bought. Gating behind a tier nobody can buy is just deleting a feature.
    delete process.env.POLAR_PRO_PRODUCT_ID;
    expect(tierOf(sub({ productId: "prod_abc" }))).toBe("starter");
  });

  it("recognises the pro product once it is configured", () => {
    process.env.POLAR_PRO_PRODUCT_ID = "prod_pro";
    expect(tierOf(sub({ productId: "prod_pro" }))).toBe("pro");
    delete process.env.POLAR_PRO_PRODUCT_ID;
  });

  it("does not grant a tier for a subscription that is not active", () => {
    expect(tierOf(sub({ status: "revoked" }))).toBe("free");
    expect(tierOf(sub({ status: "past_due" }))).toBe("free");
  });
});

describe("what each tier includes", () => {
  it("keeps scheduled publishing to pro", () => {
    expect(can("pro", "scheduled_publishing")).toBe(true);
    expect(can("starter", "scheduled_publishing")).toBe(false);
    expect(can("free", "scheduled_publishing")).toBe(false);
  });

  it("never withholds the thing that helps someone decide", () => {
    // The trial should show what the product knows. Drafting, the daily plan and the audit
    // are how it proves it is worth paying for, so gating them would be self-defeating.
    for (const f of ["drafting", "daily_plan", "seo_audit"] as const) {
      expect(can("free", f), `free should include ${f}`).toBe(true);
    }
  });

  it("gives a paid tier everything the tier below it has", () => {
    // A plan that costs more and silently drops a feature is a bug, not a pricing decision.
    for (const f of featuresOf("free")) expect(can("starter", f), `starter lost ${f}`).toBe(true);
    for (const f of featuresOf("starter")) expect(can("pro", f), `pro lost ${f}`).toBe(true);
  });
});

describe("what someone without it is told", () => {
  it("names the tier and says the work is not lost", () => {
    const m = upgradeMessage("scheduled_publishing");
    expect(m).toMatch(/Pro/);
    // The fear when a publishing feature is locked is that the drafts vanished. Answer it in
    // the same sentence rather than leaving them to find out.
    expect(m).toMatch(/nothing is lost|still written/i);
  });
});

describe("the gate the dispatcher uses", () => {
  it("gives an anonymous workspace no plan", async () => {
    // "anon:<wsid>" has nobody to bill. That is the correct answer, not a missing case.
    const { tierForTenant } = await import("@/lib/billing/plans");
    expect(await tierForTenant("anon:abc123")).toBe("free");
  });

  it("resolves a signed-in workspace through its subscription", async () => {
    const { tierForTenant } = await import("@/lib/billing/plans");
    // No subscription for this id in the in-memory repo, so free.
    expect(await tierForTenant("user:nobody")).toBe("free");
  });

  it("fails closed, not open", async () => {
    // accessForUser fails OPEN so an outage never locks out a paying customer. This decides
    // whether to publish to a real audience unattended, so it fails the other way: a database
    // blip must not push a post out.
    const { tierForTenant } = await import("@/lib/billing/plans");
    expect(await tierForTenant("user:")).toBe("free");
  });
});
