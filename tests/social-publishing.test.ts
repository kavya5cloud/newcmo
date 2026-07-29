import { describe, it, expect } from "vitest";
import { SocialPublishingEngine } from "@/lib/social/engine";
import { createAdapterRegistry } from "@/lib/social/registry";
import { seal, open } from "@/lib/social/crypto";
import { zonedTimeToEpoch, parseSchedule, backoffMs, isDue } from "@/lib/social/scheduler";
import { SOCIAL_PLATFORMS, type PublishRequest, type Asset, type SocialAdapter, type SocialPlatform } from "@/lib/social/types";
import { InMemoryCredentialStore } from "@/lib/social/oauth";
import { InMemoryAccountStore, InMemoryHistoryStore, InMemoryJobStore } from "@/lib/social/store";

const clock = () => { let t = 1_000_000; return () => (t += 1000); };

async function connected(engine: SocialPublishingEngine, platform: SocialPlatform = "linkedin") {
  const acc = await engine.connectAccount("t1", platform, "code123", "@populr");
  return acc;
}
function req(accountId: string, over: Partial<PublishRequest> = {}): PublishRequest {
  return { tenant: "t1", accountId, platform: "linkedin", content: { text: "Hello founders", assetIds: [] }, assets: [], ...over };
}

describe("Token encryption", () => {
  it("round-trips and never exposes plaintext", () => {
    const sealed = seal("secret-access-token");
    expect(sealed.ciphertext).not.toContain("secret");
    expect(open(sealed)).toBe("secret-access-token");
  });
});

describe("Adapters", () => {
  it("all 6 platforms implement the full interface + constraints", () => {
    const reg = createAdapterRegistry();
    expect(reg.platforms().sort()).toEqual([...SOCIAL_PLATFORMS].sort());
    for (const a of reg.list()) {
      for (const m of ["publish", "schedule", "delete", "refreshToken", "validateConnection", "constraints"] as (keyof SocialAdapter)[]) {
        expect(typeof a[m]).toBe("function");
      }
      expect(a.constraints().maxText).toBeGreaterThan(0);
    }
  });

  it("enforce platform constraints (X 280 chars, Instagram requires media)", async () => {
    const reg = createAdapterRegistry(() => 0);
    const token = { accessToken: "a", refreshToken: "r", expiresAt: 10_000, scopes: [], externalId: "e", handle: "h" };
    const longText = "x".repeat(300);
    const xr = await reg.get("x")!.publish(req("acc", { platform: "x", content: { text: longText, assetIds: [] } }), token);
    expect(xr.ok).toBe(false);
    const igr = await reg.get("instagram_business")!.publish(req("acc", { platform: "instagram_business" }), token);
    expect(igr.ok).toBe(false); // requires an asset
  });
});

describe("Timezone-aware scheduler", () => {
  it("converts wall-clock in a zone to the correct UTC epoch", () => {
    // 2026-01-15 12:00 in UTC == that instant
    const utc = zonedTimeToEpoch({ year: 2026, month: 1, day: 15, hour: 12, minute: 0 }, "UTC");
    expect(new Date(utc).toISOString()).toBe("2026-01-15T12:00:00.000Z");
    // New York in January is UTC-5, so 12:00 local == 17:00 UTC
    const ny = zonedTimeToEpoch({ year: 2026, month: 1, day: 15, hour: 12, minute: 0 }, "America/New_York");
    expect(new Date(ny).toISOString()).toBe("2026-01-15T17:00:00.000Z");
    expect(parseSchedule("2026-01-15T12:00", "UTC")).toBe(utc);
  });

  it("backoff is exponential", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
  });
});

describe("Publishing engine", () => {
  it("connects an account with an encrypted credential", async () => {
    const engine = new SocialPublishingEngine({ now: clock() });
    const acc = await connected(engine);
    expect(acc.status).toBe("connected");
    expect((await engine.validateAccount(acc.id)).ok).toBe(true);
    expect((await engine.listAccounts("t1")).length).toBe(1);
  });

  it("publishes now through the adapter", async () => {
    const engine = new SocialPublishingEngine({ now: clock() });
    const acc = await connected(engine);
    const job = await engine.publishNow(req(acc.id));
    expect(job.state).toBe("published");
    expect(job.result?.permalink).toContain("populr://post/linkedin");
    expect((await engine.listHistory("t1")).length).toBe(1);
  });

  it("is idempotent — same key never publishes twice", async () => {
    const engine = new SocialPublishingEngine({ now: clock() });
    const acc = await connected(engine);
    const a = await engine.publishNow(req(acc.id, { idempotencyKey: "k1" }));
    const b = await engine.publishNow(req(acc.id, { idempotencyKey: "k1" }));
    expect(a.id).toBe(b.id);
  });

  it("schedules and dispatches when due (timezone-aware)", async () => {
    const now = clock();
    const engine = new SocialPublishingEngine({ now });
    const acc = await connected(engine);
    const at = parseSchedule("2030-06-01T09:00", "UTC")!;
    const job = await engine.schedule(req(acc.id), at, "UTC");
    expect(job.state).toBe("scheduled");
    expect(isDue(job, now())).toBe(false);        // not due yet
    expect((await engine.dispatchDue(at + 1000)).length).toBe(1); // due at time
    expect((await engine.getJob(job.id))!.state).toBe("published");
  });

  it("dispatches a persisted schedule after a cold worker start", async () => {
    const now = clock();
    const stores = {
      accounts: new InMemoryAccountStore(),
      credentials: new InMemoryCredentialStore(),
      jobs: new InMemoryJobStore(),
      history: new InMemoryHistoryStore(),
    };
    const first = new SocialPublishingEngine({ now, stores });
    const acc = await connected(first);
    const at = now() + 10_000;
    const scheduled = await first.schedule(req(acc.id), at, "UTC");

    const worker = new SocialPublishingEngine({ now, stores });
    expect((await worker.dispatchDue(at + 1)).map((job) => job.id)).toEqual([scheduled.id]);
    expect((await worker.getJob(scheduled.id))!.state).toBe("published");
  });

  it("cancels a scheduled job", async () => {
    const engine = new SocialPublishingEngine({ now: clock() });
    const acc = await connected(engine);
    const job = await engine.schedule(req(acc.id), 99_999_999_999, "UTC");
    expect(await engine.cancel(job.id)).toBe(true);
    expect((await engine.getJob(job.id))!.state).toBe("cancelled");
  });

  it("retries with backoff then dead-letters, and manual retry re-queues", async () => {
    const engine = new SocialPublishingEngine({ now: clock(), maxRetries: 2 });
    const acc = await connected(engine, "instagram_business");
    // Instagram requires an asset → publish fails; drive attempts until dead-letter.
    let job = await engine.publishNow(req(acc.id, { platform: "instagram_business" }));
    expect(job.state).toBe("queued"); // first failure → retry queued
    for (let i = 0; i < 5; i++) { job = (await engine.runJob(job.id))!; if (job.state === "dead_letter") break; }
    expect(job.state).toBe("dead_letter");
    expect(engine.metrics("t1").deadLetter).toBe(1);
    // manual retry re-queues (still fails, but the control works)
    const r = await engine.retry(job.id);
    expect(r).not.toBeNull();
  });

  it("supports drafts (CRUD) and multiple assets", async () => {
    const engine = new SocialPublishingEngine({ now: clock() });
    const assets: Asset[] = [SocialPublishingEngine.asset("image", "populr://media/a", "image/png"), SocialPublishingEngine.asset("image", "populr://media/b", "image/png")];
    const d = await engine.createDraft("t1", "Launch post", ["linkedin", "x"], { text: "hi", assetIds: assets.map((a) => a.id) });
    expect((await engine.listDrafts("t1")).length).toBe(1);
    const upd = await engine.updateDraft(d.id, { title: "Launch post v2" });
    expect(upd!.title).toBe("Launch post v2");
    await engine.deleteDraft(d.id);
    expect((await engine.listDrafts("t1")).length).toBe(0);

    const acc = await connected(engine, "facebook_pages");
    const job = await engine.publishNow(req(acc.id, { platform: "facebook_pages", assets, content: { text: "multi", assetIds: assets.map((a) => a.id) } }));
    expect(job.state).toBe("published");
    expect(job.assets.length).toBe(2);
  });
});
