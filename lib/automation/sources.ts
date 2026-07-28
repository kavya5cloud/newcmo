import { composeWithAi } from "@/lib/content/ai";
import { resolvePlan } from "@/lib/launch/shared";
import { socialEngine } from "@/lib/social/shared";
import { ugcRepo } from "@/lib/ugc/shared";
import type { SocialPlatform } from "@/lib/social/types";
import type { ContentSource, QueueItem } from "./types";

// Where a slot's content actually comes from.
//
// One resolver per source, each reading from the service that already owns that content.
// Nothing here generates, formats or trims text on its own: `ai_queue` calls the existing
// composer, which already assembles brand, market, memory and learning context, routes
// through the multi-provider LLM layer, sizes variants to each platform's real limits, and
// falls back to the deterministic composer when every provider is down.
//
// A resolver that has nothing to say returns null. The runner then fails the slot with
// "no content available", which is true — publishing filler on a schedule is how an
// automation destroys a brand quietly.

export type ResolvedContent = {
  text: string;
  assetIds: string[];
  /** How this content came to exist, for the record and for Learning. */
  origin: ContentSource | "fallback";
  provider: string | null;
  model: string | null;
  confidence: number | null;
  /** Set when the resolver persisted a draft, so the slot can be traced back to it. */
  draftId?: string;
};

export type ResolveDeps = {
  /** What the automation is broadly about, used as the generation prompt. */
  topic: string;
  audience: string;
  now: number;
};

/** The oldest draft that can go to this platform. Drafts are consumed oldest-first. */
async function fromDrafts(slot: QueueItem): Promise<ResolvedContent | null> {
  const drafts = await socialEngine().listDrafts(slot.tenant).catch(() => []);
  const match = drafts.find((d) => d.platforms.includes(slot.platform)) ?? drafts.find((d) => d.platforms.length === 0);
  if (!match || !match.content.text.trim()) return null;
  return {
    text: match.content.text, assetIds: match.content.assetIds,
    origin: "drafts", provider: null, model: null, confidence: null, draftId: match.id,
  };
}

/** The next unpublished asset the launch plan scheduled for this platform's channel. */
async function fromCampaigns(slot: QueueItem): Promise<ResolvedContent | null> {
  const plan = await resolvePlan(slot.tenant, null).catch(() => null);
  if (!plan) return null;
  const root = slot.platform.split("_")[0];
  const next = plan.publishingSchedule.find((s) => s.channel.toLowerCase().includes(root));
  if (!next) return null;
  const campaign = plan.campaigns.find((c) => next.assetKey.startsWith(`${c.id}:`));
  const text = `${campaign?.title ?? plan.mission} — ${next.kind.replace(/_/g, " ")}`;
  return { text, assetIds: [], origin: "campaigns", provider: null, model: null, confidence: null };
}

/** An approved UGC caption. Only approved: a rejected script must never post itself. */
async function fromUgc(slot: QueueItem): Promise<ResolvedContent | null> {
  const packages = await ugcRepo().list(slot.tenant, 20).catch(() => []);
  for (const pkg of packages) {
    const approved = pkg.versions.find((v) => v.status === "approved");
    if (approved) {
      return {
        text: `${approved.caption}\n\n${approved.hashtags.join(" ")}`.trim(),
        assetIds: [], origin: "ugc_library", provider: null, model: null, confidence: null,
      };
    }
  }
  return null;
}

/**
 * Templates are real structures filled from the automation's own topic — not stock
 * marketing lines. They exist so a founder can automate a recurring shape (a weekly
 * lesson, a build-in-public update) without a model call every time.
 */
const TEMPLATES: ((topic: string, audience: string) => string)[] = [
  (t, a) => `One thing we learned building ${t}:\n\nMost ${a} hit the same wall, and the workaround costs more than the problem.\n\nWhat changed it for us was doing the smallest version first, then measuring.`,
  (t) => `Shipping update on ${t}.\n\nWhat changed this week, why it mattered, and what's next.`,
  (t, a) => `If you're ${a} and looking at ${t}: start with one real task, not a pilot. If it doesn't hold up there, it won't hold up at scale.`,
];

function fromTemplates(deps: ResolveDeps, slot: QueueItem): ResolvedContent {
  // Rotate deterministically on the slot time so a weekly automation doesn't repeat
  // the same template every week.
  const pick = TEMPLATES[Math.floor(slot.at / 86_400_000) % TEMPLATES.length];
  return {
    text: pick(deps.topic, deps.audience), assetIds: [],
    origin: "templates", provider: null, model: null, confidence: null,
  };
}

/** The most recent generated text asset that hasn't been published yet. */
async function fromContentLibrary(slot: QueueItem): Promise<ResolvedContent | null> {
  // The content library's durable record is generation history; drafts are its
  // publishable surface. Reading drafts here keeps one path to "text ready to post"
  // rather than a second, subtly different one.
  const drafts = await socialEngine().listDrafts(slot.tenant).catch(() => []);
  const match = drafts.find((d) => d.content.text.trim().length > 0);
  if (!match) return null;
  return {
    text: match.content.text, assetIds: match.content.assetIds,
    origin: "content_library", provider: null, model: null, confidence: null, draftId: match.id,
  };
}

/**
 * The AI queue: Populr writes the post when the slot comes up.
 *
 * Delegates entirely to `composeWithAi`, which owns context assembly, provider routing,
 * fallback and platform sizing. The variant for this slot's platform is the one that
 * ships — already trimmed to that platform's real limit by the composer.
 *
 * The result is saved as a draft so the post that went out is inspectable afterwards,
 * and so a failed publish can be retried without regenerating (and paying) again.
 */
async function fromAiQueue(slot: QueueItem, deps: ResolveDeps): Promise<ResolvedContent | null> {
  const result = await composeWithAi({
    tenant: slot.tenant,
    prompt: deps.topic,
    format: "post",
    audience: deps.audience,
    platforms: [slot.platform as SocialPlatform],
    now: deps.now,
  }).catch(() => null);

  if (!result) return null;

  const variant = result.composed.variants.find((v) => v.platform === slot.platform);
  const text = (variant?.text ?? result.composed.body).trim();
  if (!text) return null;

  const withTags = result.composed.hashtags.length
    ? `${text}\n\n${result.composed.hashtags.slice(0, 4).join(" ")}`
    : text;

  // Persist before publishing. If the publish fails, the words still exist.
  let draftId: string | undefined;
  try {
    const draft = await socialEngine().createDraft(
      slot.tenant,
      `Automated · ${slot.platform} · ${new Date(slot.at).toISOString().slice(0, 10)}`,
      [slot.platform as SocialPlatform],
      { text: withTags, assetIds: [] },
    );
    draftId = draft.id;
  } catch { /* the draft is a convenience; a storage failure must not block the post */ }

  return {
    text: withTags,
    assetIds: [],
    // `composeWithAi` reports whether a model or the deterministic composer wrote it.
    origin: result.source === "deterministic" ? "fallback" : "ai_queue",
    provider: result.provider,
    model: result.model,
    confidence: result.confidence,
    draftId,
  };
}

/**
 * Resolve content for a slot from its source.
 *
 * Sources that come up empty fall through to the AI queue rather than failing the slot —
 * an automation whose drafts ran out should keep posting, which is the entire promise.
 * Only when generation itself produces nothing does the slot fail.
 */
export async function resolveContent(slot: QueueItem, deps: ResolveDeps): Promise<ResolvedContent | null> {
  const direct = await (async (): Promise<ResolvedContent | null> => {
    switch (slot.source) {
      case "drafts": return fromDrafts(slot);
      case "campaigns": return fromCampaigns(slot);
      case "ugc_library": return fromUgc(slot);
      case "content_library": return fromContentLibrary(slot);
      case "templates": return fromTemplates(deps, slot);
      case "ai_queue": return null;      // handled below, so it isn't attempted twice
    }
  })().catch(() => null);

  if (direct) return direct;
  return fromAiQueue(slot, deps);
}
