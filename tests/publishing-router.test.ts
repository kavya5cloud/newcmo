import { describe, it, expect } from "vitest";
import { createDefaultRegistry } from "@/lib/publishing/registry";
import { PublishingRouter } from "@/lib/publishing/router";
import { platformFor } from "@/lib/publishing/providers";
import type { PublishTarget } from "@/lib/publishing/types";

function target(over: Partial<PublishTarget> = {}): PublishTarget {
  return { assetKey: "c1:linkedin_post", platform: "linkedin", content: "Hello founders", ...over };
}

describe("Publishing Router", () => {
  it("selects the provider for the target platform and publishes", async () => {
    const router = new PublishingRouter(createDefaultRegistry());
    const r = await router.publish(target());
    expect(r.ok).toBe(true);
    expect(r.platform).toBe("linkedin");
    expect(r.status).toBe("published");
    expect(r.publishedUrl).toContain("populr://published/linkedin");
    expect(router.history().length).toBe(1);
  });

  it("retries a failing provider then falls back", async () => {
    const router = new PublishingRouter(createDefaultRegistry(), {
      maxRetries: 2,
      shouldFail: (platform) => platform === "linkedin", // primary always fails
      fallbackPlatform: "website",
    });
    const r = await router.publish(target());
    expect(r.ok).toBe(true);
    expect(r.fellBack).toBe(true);
    expect(r.platform).toBe("website");
    expect(r.failures).toBe(3); // maxRetries+1 attempts failed on primary
  });

  it("rate-limits when a platform exceeds its budget", async () => {
    const router = new PublishingRouter(createDefaultRegistry()); // youtube limit = 2
    await router.publish(target({ platform: "youtube", assetKey: "a" }));
    await router.publish(target({ platform: "youtube", assetKey: "b" }));
    const third = await router.publish(target({ platform: "youtube", assetKey: "c" }));
    expect(third.status).toBe("queued");
    expect(third.error).toBe("rate_limited");
  });

  it("schedules via the provider", async () => {
    const router = new PublishingRouter(createDefaultRegistry());
    const r = await router.schedule(target({ scheduledAt: 999 }));
    expect(r.status).toBe("scheduled");
    expect(r.previewUrl).toBeTruthy();
  });

  it("resolves platforms from asset kind deterministically", () => {
    expect(platformFor("hero_video")).toBe("youtube");
    expect(platformFor("ugc_video")).toBe("tiktok");
    expect(platformFor("linkedin_post")).toBe("linkedin");
    expect(platformFor("email")).toBe("email");
    expect(platformFor("blog", "articles")).toBe("website");
  });
});
