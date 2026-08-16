import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { accessFor, ACCESS_MESSAGE, normalizeStatus, GRACE_DAYS, type Subscription } from "@/lib/billing/access";
import { verifyWebhook, parseSubscriptionEvent, isHandled } from "@/lib/billing/webhook";
import { InMemorySubscriptionRepo } from "@/lib/billing/store";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 10);

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  userId: "u1", externalId: "sub_1", status: "active",
  currentPeriodEnd: NOW + 20 * DAY, productId: "prod_1", updatedAt: NOW, ...over,
});

describe("who gets access", () => {
  it("lets a paying customer in", () => {
    const a = accessFor({ trialEndsAt: NOW - 90 * DAY, subscription: sub() }, NOW);
    expect(a.allowed).toBe(true);
    expect(a.reason).toBe("subscription");
  });

  it("never tells a paying customer their trial ended", () => {
    // The gates called isTrialActive directly, so the first person to pay would have been
    // locked out on day 31 by a check that had never heard of subscriptions.
    const a = accessFor({ trialEndsAt: NOW - 400 * DAY, subscription: sub() }, NOW);
    expect(a.reason).not.toBe("trial_ended");
  });

  it("honours a cancelled subscription until the period it paid for ends", () => {
    // Cancelled is not expired. Cutting access the moment someone cancels takes back time
    // they already bought.
    const a = accessFor({ trialEndsAt: null, subscription: sub({ status: "canceled" }) }, NOW);
    expect(a.allowed).toBe(true);
    expect(a.reason).toBe("period_remaining");
  });

  it("closes a cancelled subscription once that period is over", () => {
    const a = accessFor({ trialEndsAt: null, subscription: sub({ status: "canceled", currentPeriodEnd: NOW - DAY }) }, NOW);
    expect(a.allowed).toBe(false);
  });

  it("gives a failed payment a few days rather than locking out that morning", () => {
    const failed = sub({ status: "past_due", updatedAt: NOW - DAY });
    const a = accessFor({ trialEndsAt: null, subscription: failed }, NOW);
    expect(a.allowed).toBe(true);
    expect(a.reason).toBe("grace");
  });

  it("ends the grace period when it ends", () => {
    const failed = sub({ status: "past_due", updatedAt: NOW - (GRACE_DAYS + 1) * DAY });
    const a = accessFor({ trialEndsAt: null, subscription: failed }, NOW);
    expect(a.allowed).toBe(false);
    expect(a.reason).toBe("payment_failed");
  });

  it("distinguishes a failed payment from a finished trial", () => {
    // One asks for a new card. The other asks for a decision. Same lockout, different fix.
    expect(ACCESS_MESSAGE.payment_failed).not.toBe(ACCESS_MESSAGE.trial_ended);
    expect(ACCESS_MESSAGE.payment_failed).toMatch(/card/i);
  });

  it("still honours the free trial when nobody has paid", () => {
    const a = accessFor({ trialEndsAt: NOW + DAY, subscription: null }, NOW);
    expect(a.allowed).toBe(true);
    expect(a.reason).toBe("trial");
  });

  it("closes the door when the trial is over and there is no subscription", () => {
    const a = accessFor({ trialEndsAt: NOW - DAY, subscription: null }, NOW);
    expect(a.allowed).toBe(false);
    expect(a.reason).toBe("trial_ended");
  });

  it("offers a way forward in every refusal message", () => {
    for (const reason of ["trial_ended", "payment_failed"] as const) {
      expect(ACCESS_MESSAGE[reason].length).toBeGreaterThan(30);
    }
  });
});

describe("provider statuses", () => {
  it("treats a provider trial as active", () => {
    expect(normalizeStatus("trialing")).toBe("active");
  });

  it("treats anything unrecognised as revoked, not active", () => {
    // Defaulting an unknown status to active is how a refunded account keeps access
    // forever — and nobody ever reports being over-served.
    expect(normalizeStatus("something_new")).toBe("revoked");
    expect(normalizeStatus("")).toBe("revoked");
  });

  it("accepts both spellings of cancelled", () => {
    expect(normalizeStatus("canceled")).toBe("canceled");
    expect(normalizeStatus("cancelled")).toBe("canceled");
  });
});

describe("webhook verification", () => {
  const secret = "whsec_" + Buffer.from("super-secret-key").toString("base64");
  const body = JSON.stringify({ type: "subscription.active", data: { id: "sub_1" } });
  const id = "msg_1";
  const ts = String(Math.floor(NOW / 1000));
  const sign = (b: string, t = ts, i = id) =>
    createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${i}.${t}.${b}`).digest("base64");

  it("accepts a correctly signed request", () => {
    const r = verifyWebhook({ rawBody: body, headers: { id, timestamp: ts, signature: sign(body) }, secret }, NOW);
    expect(r.ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    // The whole point: this endpoint grants paid access.
    const good = sign(body);
    const tampered = JSON.stringify({ type: "subscription.active", data: { id: "sub_HACKED" } });
    const r = verifyWebhook({ rawBody: tampered, headers: { id, timestamp: ts, signature: good }, secret }, NOW);
    expect(r.ok).toBe(false);
  });

  it("rejects a replayed event", () => {
    // Without the timestamp check a signature is valid forever, so an old "active" event
    // could be replayed after a refund.
    const oldTs = String(Math.floor((NOW - 60 * 60 * 1000) / 1000));
    const r = verifyWebhook({ rawBody: body, headers: { id, timestamp: oldTs, signature: sign(body, oldTs) }, secret }, NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("stale");
  });

  it("refuses to run without a secret rather than passing everything", () => {
    const r = verifyWebhook({ rawBody: body, headers: { id, timestamp: ts, signature: sign(body) }, secret: "" }, NOW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("missing_secret");
  });

  it("rejects missing headers", () => {
    const r = verifyWebhook({ rawBody: body, headers: { id: null, timestamp: ts, signature: "x" }, secret }, NOW);
    expect(r.ok).toBe(false);
  });
});

describe("reading the event", () => {
  it("takes the user from checkout metadata, never from email", () => {
    // Two accounts can share an email address, and an email in a payload proves nothing.
    const p = parseSubscriptionEvent({
      data: { id: "sub_1", status: "active", metadata: { user_id: "u_42" }, customer: { email: "a@b.com" } },
    });
    expect(p?.userId).toBe("u_42");
  });

  it("returns no user rather than guessing from the email", () => {
    const p = parseSubscriptionEvent({ data: { id: "sub_1", status: "active", customer: { email: "a@b.com" } } });
    expect(p?.userId).toBe(null);
  });

  it("survives a payload with fields it has never seen", () => {
    const p = parseSubscriptionEvent({ data: { id: "sub_1", status: "active", brand_new_field: { nested: true } } });
    expect(p?.externalId).toBe("sub_1");
  });

  it("refuses a payload with no subscription id", () => {
    expect(parseSubscriptionEvent({ data: { status: "active" } })).toBe(null);
    expect(parseSubscriptionEvent(null)).toBe(null);
  });

  it("handles the events that change access, and ignores the rest", () => {
    expect(isHandled("subscription.active")).toBe(true);
    expect(isHandled("subscription.revoked")).toBe(true);
    expect(isHandled("checkout.created")).toBe(false);
  });
});

describe("storage", () => {
  it("keeps one row per user and overwrites it", async () => {
    // The provider owns billing truth; a local history would only create a second version
    // to disagree with.
    const repo = new InMemorySubscriptionRepo();
    await repo.upsert(sub({ status: "active" }));
    await repo.upsert(sub({ status: "canceled" }));
    expect((await repo.get("u1"))?.status).toBe("canceled");
  });

  it("finds a subscription by the provider's id, for renewals with no metadata", async () => {
    const repo = new InMemorySubscriptionRepo();
    await repo.upsert(sub());
    expect((await repo.byExternalId("sub_1"))?.userId).toBe("u1");
    expect(await repo.byExternalId("nope")).toBe(null);
  });
});

describe("configuration", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it("treats half-configured billing as off", async () => {
    // A token with no product is a Subscribe button that fails after the click, which is
    // worse than no button.
    const { billingConfig } = await import("@/lib/billing/polar");
    process.env.POLAR_ACCESS_TOKEN = "tok";
    delete process.env.POLAR_PRODUCT_ID;
    expect(billingConfig().configured).toBe(false);
  });

  it("keeps sandbox and production apart", async () => {
    const { billingConfig } = await import("@/lib/billing/polar");
    process.env.POLAR_ENV = "production";
    expect(billingConfig().server).toBe("production");
    process.env.POLAR_ENV = "sandbox";
    expect(billingConfig().server).toBe("sandbox");
  });

  it("defaults to sandbox, so a missing setting cannot charge a real card", async () => {
    const { billingConfig } = await import("@/lib/billing/polar");
    delete process.env.POLAR_ENV;
    expect(billingConfig().server).toBe("sandbox");
  });
});

describe("the customer is decided by the server, never the caller", () => {
  const code = (p: string) =>
    readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");

  it("checkout discards whatever the query string asked for", () => {
    // Polar's Checkout() reads products and customerExternalId from the query. Mounted the
    // way the quickstart shows — `export const GET = Checkout({...})` — anyone could call
    // ?customerExternalId=<someone else> and attach a subscription to another account.
    // The route rebuilds the search string from the session instead.
    const src = code("app/api/billing/checkout/route.ts");
    expect(src).toMatch(/url\.search = ""/);
    expect(src).toMatch(/customerExternalId", session\.userId/);
    expect(src).toMatch(/products", cfg\.productId/);
  });

  it("the portal takes its customer from the session, not the request", () => {
    // Same hole, worse consequence: the portal shows payment history.
    const src = code("app/api/billing/portal/route.ts");
    expect(src).toMatch(/getExternalCustomerId: async \(\) => session\.userId/);
  });

  it("both routes refuse anonymous callers", () => {
    for (const p of ["app/api/billing/checkout/route.ts", "app/api/billing/portal/route.ts"]) {
      expect(code(p), p).toMatch(/if \(!session\)/);
    }
  });
});

describe("granting access", () => {
  const code = (p: string) =>
    readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");

  it("only the webhook writes a subscription", () => {
    // A checkout URL means somebody clicked a button, not that they paid.
    for (const p of [
      "app/api/billing/route.ts",
      "app/api/billing/checkout/route.ts",
      "app/api/billing/portal/route.ts",
    ]) {
      expect(code(p), `${p} writes a subscription`).not.toMatch(/\.upsert\(/);
    }
    expect(code("app/api/webhooks/polar/route.ts")).toMatch(/\.upsert\(/);
  });

  it("verification is the adapter's, so there is no hand-rolled signature check", () => {
    // The previous implementation coded Standard Webhooks from the spec and had never been
    // checked against a live event. A signature check that is subtly wrong either rejects
    // every real payment or accepts forged ones.
    const src = code("app/api/webhooks/polar/route.ts");
    expect(src).toMatch(/Webhooks\(\{/);
    expect(src).toMatch(/webhookSecret: billingConfig\(\)\.webhookSecret/);
    expect(src).not.toMatch(/createHmac/);
  });

  it("identifies the payer by the id we attached, never by email", () => {
    const src = code("app/api/webhooks/polar/route.ts");
    expect(src).toMatch(/customer\?\.externalId/);
    expect(src).not.toMatch(/customerEmail|customer\?\.email/);
  });
});

describe("the events we subscribe to", () => {
  it("includes past_due, or the grace period is unreachable code", async () => {
    // accessFor gives a failed payment three days. That window is built on the past_due
    // status, and nothing but this event sets it — the logic was correct and could never run.
    const { isHandled } = await import("@/lib/billing/webhook");
    expect(isHandled("subscription.past_due")).toBe(true);
  });

  it("lists only events the SDK can actually parse", async () => {
    // This replaces a test that required cycled/paused/resumed. That test encoded what we
    // wanted rather than what works: @polar-sh/sdk validates each payload against a schema
    // keyed by event type and throws on a type it does not know, before any handler runs.
    // Subscribing to one of those three produced a 500 on every delivery — and Polar retries
    // a 500, so the failure repeats rather than passing quietly.
    const { HANDLED_EVENTS } = await import("@/lib/billing/webhook");
    const PARSEABLE = new Set([
      "subscription.created", "subscription.active", "subscription.updated",
      "subscription.past_due", "subscription.canceled", "subscription.uncanceled",
      "subscription.revoked",
    ]);
    for (const e of HANDLED_EVENTS) {
      expect(PARSEABLE.has(e), `${e} is not parseable by the SDK — it would 500 on delivery`).toBe(true);
    }
  });

  it("covers the lifecycle events that change access", async () => {
    // Renewals and pause/resume still reach us: Polar sends subscription.updated alongside
    // those transitions, carrying the status that record() writes.
    const { isHandled } = await import("@/lib/billing/webhook");
    for (const e of ["created", "active", "updated", "past_due", "canceled", "uncanceled", "revoked"]) {
      expect(isHandled(`subscription.${e}`), `subscription.${e} unhandled`).toBe(true);
    }
  });

  it("ignores events that do not change access", async () => {
    // Subscribing to order.* and checkout.* would double-handle the same state change.
    const { isHandled } = await import("@/lib/billing/webhook");
    for (const e of ["checkout.created", "order.paid", "customer.updated", "benefit.created"]) {
      expect(isHandled(e), `${e} should be ignored`).toBe(false);
    }
  });

  it("treats a paused subscription as no access", async () => {
    const { normalizeStatus } = await import("@/lib/billing/access");
    expect(normalizeStatus("paused")).toBe("revoked");
  });
});

describe("a browser navigating to billing always gets a page", () => {
  const code = (p: string) =>
    readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  // Clicking Subscribe downloaded an empty file called "checkout" and left the page where it
  // was. The route answered a failure with JSON, and a navigation that receives
  // application/json shows no error — the browser saves it. Nothing on screen changed, so
  // the button looked dead.

  for (const route of ["app/api/billing/checkout/route.ts", "app/api/billing/portal/route.ts"]) {
    it(`${route} never answers a navigation with JSON`, () => {
      expect(code(route), `${route} still returns JSON`).not.toMatch(/NextResponse\.json/);
    });

    it(`${route} redirects on every failure`, () => {
      const src = code(route);
      expect(src).toMatch(/function back\(reason: string\)/);
      expect(src).toMatch(/NextResponse\.redirect/);
    });

    it(`${route} catches a throw from the adapter`, () => {
      // An uncaught throw is a 500, which the browser also declines to render.
      expect(code(route)).toMatch(/catch \(e\)/);
    });

    it(`${route} treats a non-redirect from the adapter as a failure`, () => {
      // The adapter answers with JSON when Polar refuses — bad token, missing product,
      // wrong environment. That has to become a redirect too.
      expect(code(route)).toMatch(/headers\.get\("location"\)/);
    });
  }

  it("the panel can explain every reason the routes send", () => {
    const ui = readFileSync(new URL("../app/components/Billing.tsx", import.meta.url), "utf8");
    const sent = new Set<string>();
    for (const route of ["app/api/billing/checkout/route.ts", "app/api/billing/portal/route.ts"]) {
      for (const m of code(route).matchAll(/back\("([a-z_]+)"\)/g)) sent.add(m[1]);
    }
    expect(sent.size).toBeGreaterThan(2);
    for (const reason of sent) {
      expect(ui, `no message for ${reason}`).toMatch(new RegExp(`${reason}:`));
    }
  });
});
