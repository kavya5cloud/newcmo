// Talking to Polar.
//
// The only file that knows Polar exists. Everything else — the access model, the gate, the
// store — works from plain types, so replacing the provider is this file plus the webhook
// parser, not a rewrite.
//
// Endpoint paths and response field names are the two things most likely to be wrong here,
// so both are isolated: paths are constants at the top, and the response readers accept
// several field spellings rather than one. VERIFY AGAINST POLAR'S CURRENT API DOCS before
// taking real money.

const PRODUCTION = "https://api.polar.sh";
const SANDBOX = "https://sandbox-api.polar.sh";

/** Sandbox and production are separate environments with separate tokens and separate data. */
export function polarBase(): string {
  return (process.env.POLAR_ENV || "sandbox").toLowerCase() === "production" ? PRODUCTION : SANDBOX;
}

const PATHS = {
  checkout: "/v1/checkouts/",
  customerSession: "/v1/customer-sessions/",
};

export type BillingConfig = {
  token: string;
  productId: string;
  configured: boolean;
};

/**
 * Whether billing is switched on.
 *
 * Absent config is a normal state, not an error: the product runs on its free trial and the
 * Subscribe button stays hidden. A half-configured integration — a token but no product —
 * counts as off, because the alternative is a button that fails after the click.
 */
export function billingConfig(): BillingConfig {
  const token = process.env.POLAR_ACCESS_TOKEN || "";
  const productId = process.env.POLAR_PRODUCT_ID || "";
  return { token, productId, configured: Boolean(token && productId) };
}

type PolarResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function call<T>(path: string, body: unknown, token: string): Promise<PolarResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${polarBase()}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // Logged server-side; never returned to the browser. A provider error body can carry
      // account details that are none of the visitor's business.
      console.warn(JSON.stringify({ event: "polar_api_error", path, status: res.status, body: text.slice(0, 400) }));
      return { ok: false, error: `polar_${res.status}`, status: res.status };
    }
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    console.warn(JSON.stringify({ event: "polar_api_unreachable", path, aborted }));
    return { ok: false, error: aborted ? "timeout" : "network", status: 503 };
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the redirect URL out, whichever name it arrives under. */
function readUrl(data: Record<string, unknown>): string | null {
  for (const k of ["url", "checkout_url", "customer_portal_url"]) {
    const v = data[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  return null;
}

export type CheckoutInput = {
  /** Our user id. Carried into the webhook — without it a payment cannot be attributed. */
  userId: string;
  email: string | null;
  /** Where Polar returns the customer afterwards. */
  successUrl: string;
};

/**
 * Start a checkout.
 *
 * metadata.user_id is the whole reason this integration works. The webhook has no other
 * reliable way to know whose payment it is: email is not proof of identity, two accounts can
 * share one, and a renewal months later carries no session. If this field is ever dropped,
 * payments arrive and grant nothing.
 */
export async function createCheckout(input: CheckoutInput): Promise<{ url: string } | { error: string }> {
  const cfg = billingConfig();
  if (!cfg.configured) return { error: "billing_not_configured" };

  const res = await call<Record<string, unknown>>(
    PATHS.checkout,
    {
      products: [cfg.productId],
      success_url: input.successUrl,
      ...(input.email ? { customer_email: input.email } : {}),
      // Set on both: Polar copies checkout metadata onto the subscription, but being
      // explicit costs nothing and this is the field everything depends on.
      metadata: { user_id: input.userId },
      customer_metadata: { user_id: input.userId },
    },
    cfg.token,
  );

  if (!res.ok) return { error: res.error };
  const url = readUrl(res.data);
  if (!url) {
    console.warn(JSON.stringify({ event: "polar_checkout_no_url", keys: Object.keys(res.data).slice(0, 20) }));
    return { error: "no_checkout_url" };
  }
  return { url };
}

/**
 * A session for Polar's hosted billing portal.
 *
 * Where subscribers change a card or cancel. Hosting it ourselves would mean handling card
 * details, which is a compliance burden worth avoiding for a screen Polar already provides.
 */
export async function createPortalSession(customerExternalId: string): Promise<{ url: string } | { error: string }> {
  const cfg = billingConfig();
  if (!cfg.configured) return { error: "billing_not_configured" };

  const res = await call<Record<string, unknown>>(
    PATHS.customerSession,
    { customer_external_id: customerExternalId },
    cfg.token,
  );

  if (!res.ok) return { error: res.error };
  const url = readUrl(res.data);
  return url ? { url } : { error: "no_portal_url" };
}
