import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifySignature, normalizeWebhook } from "@/lib/social/webhooks";
import { createAsset, isSupportedMime, validateForPlatform, InMemoryAssetStore } from "@/lib/social/assets";
import { SocialPublishingEngine } from "@/lib/social/engine";
import type { Asset, PublishRequest } from "@/lib/social/types";

const clock = () => { let t = 1_000_000; return () => (t += 1000); };

describe("Webhook signature verification", () => {
  const prev = process.env.SOCIAL_WEBHOOK_SECRET;
  beforeEach(() => { process.env.SOCIAL_WEBHOOK_SECRET = "s3cret"; });
  afterEach(() => { if (prev === undefined) delete process.env.SOCIAL_WEBHOOK_SECRET; else process.env.SOCIAL_WEBHOOK_SECRET = prev; });

  it("accepts a correct HMAC and rejects a forged one", async () => {
    const { createHmac } = await import("node:crypto");
    const body = '{"event":"published"}';
    const good = createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifySignature(body, good)).toEqual({ ok: true, configured: true });
    expect(verifySignature(body, `sha256=${good}`).ok).toBe(true);   // prefixed form
    expect(verifySignature(body, "deadbeef").ok).toBe(false);        // forged
    expect(verifySignature(body, null).ok).toBe(false);              // missing
    expect(verifySignature('{"event":"x"}', good).ok).toBe(false);   // tampered body
  });

  it("reports unconfigured when no secret is set", () => {
    delete process.env.SOCIAL_WEBHOOK_SECRET;
    expect(verifySignature("{}", "x")).toEqual({ ok: false, configured: false });
  });
});

describe("Webhook normalization", () => {
  it("maps each platform's vocabulary onto one shape", () => {
    expect(normalizeWebhook("linkedin", { event: "post_published", data: { post_id: "p1", permalink: "u" } }).type).toBe("publish.confirmed");
    expect(normalizeWebhook("x", { type: "failed", data: { id: "p2", reason: "rate limit" } }).type).toBe("publish.failed");
    expect(normalizeWebhook("threads", { event: "post_deleted", data: { id: "p3" } }).type).toBe("post.deleted");
    expect(normalizeWebhook("facebook_pages", { event: "deauthorize", data: { user_id: "u9" } }).type).toBe("token.revoked");
    expect(normalizeWebhook("pinterest", { event: "who_knows" }).type).toBe("unknown");
  });

  it("extracts ids/permalink/error regardless of field naming", () => {
    const e = normalizeWebhook("linkedin", { event: "published", data: { post_id: "abc", link: "populr://x", message: null } });
    expect(e.externalId).toBe("abc");
    expect(e.permalink).toBe("populr://x");
  });
});

describe("Webhooks applied to the engine", () => {
  async function publishedJob() {
    const engine = new SocialPublishingEngine({ now: clock() });
    const acc = await engine.connectAccount("t1", "linkedin", "code123", "@populr");
    const req: PublishRequest = { tenant: "t1", accountId: acc.id, platform: "linkedin", content: { text: "hi", assetIds: [] }, assets: [] };
    const job = await engine.publishNow(req);
    return { engine, acc, job };
  }

  it("a failure callback moves a published job into retry", async () => {
    const { engine, job } = await publishedJob();
    expect(job.state).toBe("published");
    const res = await engine.applyWebhook({
      platform: "linkedin", type: "publish.failed", externalId: job.result!.externalId!,
      accountExternalId: null, permalink: null, error: "removed by platform",
    });
    expect(res.applied).toBe(true);
    expect((await engine.getJob(job.id))!.state).toBe("queued"); // retried, not silently lost
  });

  it("a deletion callback cancels the job", async () => {
    const { engine, job } = await publishedJob();
    await engine.applyWebhook({ platform: "linkedin", type: "post.deleted", externalId: job.result!.externalId!, accountExternalId: null, permalink: null, error: null });
    expect((await engine.getJob(job.id))!.state).toBe("cancelled");
  });

  it("token revocation disconnects the account so nothing publishes with it", async () => {
    const { engine, acc } = await publishedJob();
    const res = await engine.applyWebhook({ platform: "linkedin", type: "token.revoked", externalId: null, accountExternalId: acc.externalId, permalink: null, error: null });
    expect(res.applied).toBe(true);
    const accounts = await engine.listAccounts("t1");
    expect(accounts[0].status).toBe("disconnected");
    expect((await engine.validateAccount(acc.id)).ok).toBe(false);
  });

  it("ignores callbacks for unknown posts", async () => {
    const { engine } = await publishedJob();
    expect((await engine.applyWebhook({ platform: "x", type: "publish.confirmed", externalId: "nope", accountExternalId: null, permalink: null, error: null })).applied).toBe(false);
  });
});

describe("Asset Service", () => {
  it("derives kind from MIME and rejects unsupported types", () => {
    expect(createAsset({ uri: "populr://m/1", mime: "image/png" }).kind).toBe("image");
    expect(createAsset({ uri: "populr://m/2", mime: "video/mp4" }).kind).toBe("video");
    expect(createAsset({ uri: "populr://m/3", mime: "image/gif" }).kind).toBe("gif");
    expect(isSupportedMime("image/png")).toBe(true);
    expect(isSupportedMime("application/x-evil")).toBe(false);
  });

  it("validates against each platform's real constraints", () => {
    const img = createAsset({ uri: "populr://m/a", mime: "image/png", altText: "alt" });
    const vid = createAsset({ uri: "populr://m/b", mime: "video/mp4" });

    expect(validateForPlatform([], "instagram_business").ok).toBe(false);   // requires media
    expect(validateForPlatform([img], "instagram_business").ok).toBe(true);
    expect(validateForPlatform([vid], "pinterest").ok).toBe(false);          // no video
    expect(validateForPlatform([img, img, img, img, img], "x").ok).toBe(false); // max 4
    expect(validateForPlatform([img], "linkedin").ok).toBe(true);
  });

  it("flags images missing alt text (accessibility)", () => {
    const noAlt = createAsset({ uri: "populr://m/c", mime: "image/png" });
    const v = validateForPlatform([noAlt], "linkedin");
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/alt text/);
  });

  it("stores and lists assets per tenant", async () => {
    const store = new InMemoryAssetStore();
    const a: Asset = createAsset({ uri: "populr://m/d", mime: "image/png", altText: "x" });
    await store.save("t1", a);
    await store.save("t2", createAsset({ uri: "populr://m/e", mime: "image/png", altText: "y" }));
    expect((await store.list("t1")).length).toBe(1);
    expect(await store.get(a.id)).not.toBeNull();
    await store.remove(a.id);
    expect(await store.get(a.id)).toBeNull();
  });
});
