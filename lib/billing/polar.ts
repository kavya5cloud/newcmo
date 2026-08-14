// Polar configuration.
//
// The transport is @polar-sh/nextjs now — their adapter owns endpoint paths, API versions,
// response shapes and webhook signature verification, which were the four things this file
// previously guessed at and carried a "verify before going live" warning about.
//
// What stays ours is everything that decides anything: lib/billing/access.ts (who gets in),
// lib/billing/store.ts (what we remember), lib/billing/gate.ts (the one question routes ask).
// The adapter moved the provider specifics out; it did not move the domain in.

export type BillingConfig = {
  token: string;
  productId: string;
  webhookSecret: string;
  /** Polar keeps sandbox and production entirely separate, down to the tokens. */
  server: "sandbox" | "production";
  configured: boolean;
};

/**
 * Whether billing is switched on.
 *
 * Absent config is a normal state, not an error: the product runs on its free trial and the
 * Subscribe button stays hidden. Half-configured — a token but no product — counts as off,
 * because the alternative is a button that fails after the click.
 */
export function billingConfig(): BillingConfig {
  const token = process.env.POLAR_ACCESS_TOKEN || "";
  const productId = process.env.POLAR_PRODUCT_ID || "";
  const webhookSecret = process.env.POLAR_WEBHOOK_SECRET || "";
  // Defaults to sandbox. A missing setting must not be able to charge a real card.
  const server = (process.env.POLAR_ENV || "sandbox").toLowerCase() === "production"
    ? "production" as const
    : "sandbox" as const;

  return { token, productId, webhookSecret, server, configured: Boolean(token && productId) };
}
