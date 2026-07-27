import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { socialEngine } from "@/lib/social/shared";
import { compose, isContentFormat, isSocialPlatform, type ContentFormat } from "@/lib/content/compose";
import type { SocialPlatform } from "@/lib/social/types";

export const runtime = "nodejs";

// One prompt → a publishable set: the piece, a variant per connected platform sized to that
// platform's real limits, hashtags, CTAs, a schedule and a campaign suggestion.
//
// `POST` composes. `POST { publish: "draft" | "schedule" | "now" }` also hands the result to
// the existing Publishing Engine — same drafts, same scheduler, same adapters, same retries.

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 12, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const prompt = String(body.prompt || "").trim();
  if (!prompt) return NextResponse.json({ error: "missing_prompt" }, { status: 422 });
  if (prompt.length > 600) return NextResponse.json({ error: "prompt_too_long" }, { status: 422 });

  const format = String(body.format || "post");
  if (!isContentFormat(format)) return NextResponse.json({ error: "invalid_format" }, { status: 422 });

  const tenant = (await workspaceKey((body.wsid as string) ?? null)) ?? "default";
  const engine = socialEngine();

  try {
    // Variants are only built for platforms that can actually receive them. An explicit
    // list is honoured; otherwise the connected accounts decide.
    const requested = Array.isArray(body.platforms) ? body.platforms.filter(isSocialPlatform) : null;
    const accounts = await engine.listAccounts(tenant).catch(() => []);
    const connected = [...new Set(accounts.filter((a) => a.status === "connected").map((a) => a.platform))];
    const platforms: SocialPlatform[] = requested?.length ? requested : connected;

    const composed = compose({
      tenant, prompt, format: format as ContentFormat,
      audience: String(body.audience || "founders").slice(0, 120),
      platforms,
      now: Date.now(),
    });

    const action = String(body.publish || "");
    if (!action) {
      return NextResponse.json({
        ok: true, composed,
        connectedPlatforms: connected,
        note: platforms.length === 0
          ? "No platforms connected yet, so no platform variants were built. Connect an account in Cross-Post and re-run to get sized variants."
          : undefined,
      });
    }

    if (platforms.length === 0) {
      return NextResponse.json({ error: "no_platforms", hint: "Connect a platform in Cross-Post before publishing." }, { status: 409 });
    }

    const results: { platform: SocialPlatform; jobId: string; state: string; at: number | null }[] = [];
    for (const variant of composed.variants) {
      const account = accounts.find((a) => a.platform === variant.platform && a.status === "connected");
      if (!account) continue;

      if (action === "draft") {
        const draft = await engine.createDraft(tenant, composed.title, [variant.platform], { text: variant.text, assetIds: [] });
        results.push({ platform: variant.platform, jobId: draft.id, state: "draft", at: null });
        continue;
      }

      // Idempotent on the composed id: re-running the same prompt never double-posts.
      const request = {
        tenant, accountId: account.id, platform: variant.platform,
        content: { text: variant.text, assetIds: [] }, assets: [],
        idempotencyKey: `compose:${composed.id}:${variant.platform}`,
      };

      if (action === "schedule") {
        const slot = composed.schedule.find((s) => s.platform === variant.platform);
        const job = await engine.schedule(request, slot?.at ?? Date.now() + 3_600_000, String(body.timezone || "UTC"));
        results.push({ platform: variant.platform, jobId: job.id, state: job.state, at: job.scheduledAt });
      } else if (action === "now") {
        const job = await engine.publishNow(request);
        results.push({ platform: variant.platform, jobId: job.id, state: job.state, at: null });
      } else {
        return NextResponse.json({ error: "invalid_publish", hint: "draft | schedule | now" }, { status: 422 });
      }
    }

    return NextResponse.json({
      ok: true, composed, results,
      message: `${action === "draft" ? "Saved" : action === "schedule" ? "Scheduled" : "Published"} across ${results.length} platform${results.length === 1 ? "" : "s"}.`,
    });
  } catch (e) {
    return NextResponse.json({ error: "compose_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
