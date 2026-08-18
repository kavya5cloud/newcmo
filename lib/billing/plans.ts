import type { Subscription } from "./access";
import { subscriptionRepo } from "./store";

// What a plan includes.
//
// There has only ever been one plan, and access was binary: paid or not. Introducing a second
// tier is a pricing decision, not a code one, so the shape here is deliberately thin — a tier
// is derived from the Polar product someone actually bought, and the feature list is a map
// anyone can read in ten seconds.
//
// The tier comes from productId, which the webhook already records. Not from a flag we set by
// hand, and not from the price: a comped account, a grandfathered price and a discount code
// all produce the same product with different amounts, and every one of them should keep the
// features they were sold.
//
// Until a second product exists in Polar, everyone paying is on "starter" and nothing changes.
// That is the honest default: gating a feature behind a tier nobody can buy is just removing
// the feature.

export type Tier = "free" | "starter" | "pro";

/**
 * Things a plan can include.
 *
 * Named for what the user gets, not for the subsystem behind it. "scheduled_publishing" is a
 * promise; "cron_dispatch" would be an implementation detail that stops being true the moment
 * the dispatcher changes.
 */
export type Feature =
  /** Posts go out at their scheduled time without anyone pressing anything. */
  | "scheduled_publishing"
  /** Drafts are written, but a person publishes them. */
  | "drafting"
  /** The daily plan, the refusals, and the reasoning behind both. */
  | "daily_plan"
  /** Lighthouse and on-page audit. */
  | "seo_audit"
  /** Connecting accounts Populr can post through. */
  | "social_accounts";

const FEATURES: Record<Tier, Feature[]> = {
  // What someone gets during the free month, and after it lapses. Deliberately generous on
  // everything that helps them decide, and empty of anything that runs unattended: the trial
  // should show what the product knows, not act on their behalf.
  free: ["drafting", "daily_plan", "seo_audit"],
  starter: ["drafting", "daily_plan", "seo_audit", "social_accounts"],
  pro: ["drafting", "daily_plan", "seo_audit", "social_accounts", "scheduled_publishing"],
};

/**
 * Which product means which tier.
 *
 * Env-driven so adding the Pro product in Polar needs no deploy — set POLAR_PRO_PRODUCT_ID
 * and the mapping follows. Without it, no product maps to pro, which is correct: there is
 * nothing to sell yet.
 */
function tierForProduct(productId: string | null): Tier {
  if (!productId) return "starter";
  const pro = process.env.POLAR_PRO_PRODUCT_ID?.trim();
  if (pro && productId === pro) return "pro";
  return "starter";
}

/**
 * The tier this subscription grants.
 *
 * A subscription that is not active grants nothing beyond free — but note this says nothing
 * about whether they have *access*. accessFor() owns that, including the grace period after a
 * failed payment and the period someone paid for after cancelling. This answers only "what
 * does this plan include", and the two questions have to stay separate or a customer inside
 * their grace window loses features they are still paying for.
 */
export function tierOf(sub: Subscription | null): Tier {
  if (!sub) return "free";
  if (sub.status !== "active") return "free";
  return tierForProduct(sub.productId);
}

/** Whether a tier includes a feature. */
export function can(tier: Tier, feature: Feature): boolean {
  return FEATURES[tier].includes(feature);
}

/** Everything a tier includes, for rendering a plan comparison without a second source. */
export function featuresOf(tier: Tier): Feature[] {
  return [...FEATURES[tier]];
}

/** What to tell someone who does not have it. One line, naming the tier that does. */
export function upgradeMessage(feature: Feature): string {
  const tier = (Object.keys(FEATURES) as Tier[]).find((t) => can(t, feature));
  const label: Record<Feature, string> = {
    scheduled_publishing: "Publishing on a schedule",
    drafting: "Drafting",
    daily_plan: "The daily plan",
    seo_audit: "The SEO audit",
    social_accounts: "Connecting accounts",
  };
  if (!tier) return `${label[feature]} is not available on any plan yet.`;
  return `${label[feature]} is part of ${tier === "pro" ? "Pro" : "the paid plan"}. Your drafts are still written and waiting — nothing is lost, they just need you to press publish.`;
}


/**
 * The tier behind a workspace key.
 *
 * Workspace keys are "user:<id>" when someone is signed in and "anon:<wsid>" when they are
 * not — see workspaceKey() in lib/intel.ts. An anonymous workspace has nobody to bill and
 * therefore no plan, which is the correct answer rather than a missing case.
 *
 * Fails open to the free tier when the lookup itself fails. That is deliberate and it is the
 * opposite of how the access gate behaves: accessForUser fails open to *allowed* so an
 * outage never locks out a paying customer, but this decides whether to publish on someone's
 * behalf, and a database blip must not push a post to a real audience.
 */
export async function tierForTenant(tenant: string): Promise<Tier> {
  if (!tenant.startsWith("user:")) return "free";
  const userId = tenant.slice("user:".length);
  try {
    return tierOf(await subscriptionRepo().get(userId));
  } catch {
    return "free";
  }
}
