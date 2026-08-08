import type { CmoContext } from "@/lib/services/cmo-context";
import { ASSET_LABEL, type AssetKind } from "@/lib/services/intent-router";
import { DELIVERABLE_RULES } from "@/lib/cmo/quality-rules";

// Content Engine — when the user asks for content, produce ONLY the content.
// No recommendation, no trade-offs, no confidence, no hypotheses. It still consumes the
// shared Business State (brand voice, audience) and Creative Memory (what won / what was
// rejected) so every asset is on-brand and improves over time — but none of that reasoning
// leaks into the output. The founder asked for a post; they get a post.

const FORMAT: Record<AssetKind, string> = {
  x_post: "One X post under 280 characters. A strong first line. No hashtags unless they add real value.",
  x_thread: "A 5–7 tweet X thread. Tweet 1 is a scroll-stopping hook. Number them 1/, 2/, …. Each under 280 chars.",
  linkedin_post: "A LinkedIn post, 120–200 words. Specific opening insight, one concrete example, a soft close. Short paragraphs.",
  reddit_post: "A helpful, non-promotional Reddit post. Sound like a real practitioner, not marketing. Name a relevant subreddit on the first line.",
  blog: "A blog draft, 400–600 words, with a title line, short sections, and plain paragraphs. Specific and useful.",
  email: "A marketing email: a subject line, then 100–180 words of body. One clear CTA.",
  landing_copy: "Landing page copy: headline, subhead, 3 short benefit lines, and a CTA button label.",
  ig_carousel: "An Instagram carousel: 5–7 slides. For each slide give a short title and one line of body. Slide 1 is the hook, last slide is the CTA.",
  ig_reel_script: "An Instagram reel script: a hook (first 2 seconds), 3–5 beats with on-screen text + voiceover, and a CTA.",
  ig_caption: "An Instagram caption: a hook line, 2–3 short lines of body, a CTA, and 3–5 relevant hashtags.",
  ugc_script: "A UGC talking-head script: hook, problem, product moment, and CTA. Natural spoken language with light delivery notes.",
  headlines: "8 distinct headline options, one per line, no numbering commentary.",
  hooks: "8 distinct opening hooks, one per line.",
  cta: "6 distinct call-to-action variations, one per line.",
};

/** Brief on-brand memory: voice + audience + what won before + what to avoid. Facts only. */
function creativeMemory(ctx: CmoContext): string {
  const b = ctx.business;
  const lines: string[] = [];
  if (b.name) lines.push(`Brand: ${b.name}${b.oneLiner ? ` — ${b.oneLiner}` : ""}`);
  if (b.audience) lines.push(`Audience: ${b.audience}`);
  if (b.voice) lines.push(`Voice: ${b.voice}`);
  if (b.positioning) lines.push(`Positioning: ${b.positioning}`);
  if (ctx.whatWorked.length) lines.push(`What has worked here: ${ctx.whatWorked.slice(0, 3).map((w) => w.title).join("; ")}`);
  if (ctx.dismissed.length) lines.push(`Avoid these rejected angles: ${ctx.dismissed.slice(0, 3).map((d) => d.title).join("; ")}`);
  const activeMission = ctx.missions.find((m) => m.status === "active") || ctx.missions[0];
  if (activeMission) lines.push(`Current mission: ${activeMission.title}`);
  return lines.join("\n");
}

export function buildContentPrompt(ctx: CmoContext, asset: AssetKind, request: string): string {
  return `You are the content studio for ${ctx.business.name || "this brand"}. Produce the asset and NOTHING else.

Brand context (use it, never mention it):
${creativeMemory(ctx) || "No brand profile yet — write cleanly and specifically."}

Deliverable: ${ASSET_LABEL[asset]}.
Format: ${FORMAT[asset]}

Hard rules:
- Output ONLY the ${ASSET_LABEL[asset]}. No preamble, no explanation, no "here's", no strategy, no confidence notes, no options list unless the format itself is a list.
- On-brand voice. Ready to paste.
${DELIVERABLE_RULES}

Request: ${request}`;
}
