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

describe("the checkout adapter", () => {
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
    const { polarBase } = await import("@/lib/billing/polar");
    process.env.POLAR_ENV = "sandbox";
    expect(polarBase()).toContain("sandbox");
    process.env.POLAR_ENV = "production";
    expect(polarBase()).not.toContain("sandbox");
  });

  it("defaults to sandbox, so a missing setting cannot charge a real card", async () => {
    const { polarBase } = await import("@/lib/billing/polar");
    delete process.env.POLAR_ENV;
    expect(polarBase()).toContain("sandbox");
  });

  it("sends our user id on the checkout, since nothing else identifies the payer", async () => {
    const src = readFileSync(new URL("../lib/billing/polar.ts", import.meta.url), "utf8");
    expect(src).toMatch(/metadata:\s*\{\s*user_id:\s*input\.userId\s*\}/);
  });
});

describe("granting access", () => {
  it("only the webhook writes a subscription — never the checkout route", () => {
    // A returned checkout URL means someone clicked a button, not that they paid. Wiring
    // access to the click gives the product away to anyone who opens devtools.
    const route = readFileSync(new URL("../app/api/billing/route.ts", import.meta.url), "utf8");
    expect(route).not.toMatch(/\.upsert\(/);
  });

  it("the webhook rejects unverified requests before parsing them", () => {
    const hook = readFileSync(new URL("../app/api/webhooks/polar/route.ts", import.meta.url), "utf8");
    const verify = hook.indexOf("verifyWebhook");
    const parse = hook.indexOf("JSON.parse");
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(parse);
  });

  it("reads the body as text, because re-serialising breaks the signature", () => {
    // Asserted on the call, not the string: the file's own comment explains why req.json()
    // is wrong, and a test that cannot tell code from prose about code fails on the
    // explanation. Third time that has caught me — strip comments first.
    const hook = readFileSync(new URL("../app/api/webhooks/polar/route.ts", import.meta.url), "utf8")
      .replace(/\/\/.*$/gm, "");
    expect(hook).toMatch(/await req\.text\(\)/);
    expect(hook).not.toMatch(/await req\.json\(\)/);
  });
});

describe("the events we subscribe to", () => {
  it("includes past_due, or the grace period is unreachable code", async () => {
    // accessFor gives a failed payment three days. That window is built on the past_due
    // status, and nothing but this event sets it — the logic was correct and could never run.
    const { isHandled } = await import("@/lib/billing/webhook");
    expect(isHandled("subscription.past_due")).toBe(true);
  });

  it("includes cycled, or a renewed subscription's period never moves", async () => {
    const { isHandled } = await import("@/lib/billing/webhook");
    expect(isHandled("subscription.cycled")).toBe(true);
  });

  it("covers every subscription lifecycle event Polar sends", async () => {
    const { isHandled } = await import("@/lib/billing/webhook");
    for (const e of [
      "created", "active", "updated", "cycled", "past_due",
      "canceled", "uncanceled", "paused", "resumed", "revoked",
    ]) {
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
