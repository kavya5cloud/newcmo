import type { AssetKind } from "@/lib/creative/taxonomy";
import { ASSET_KIND_META } from "@/lib/creative/taxonomy";
import type { CreativeBriefInput } from "@/lib/creative/types";
import type { Hook, Script, ScriptSection, Story } from "./types";
import { buildStory } from "./story-engine";
import { renderHook, selectHook } from "./hook-engine";
import { idFrom, keyPhrase } from "./util";

// Script Engine — produces a fully typed script (never a free-form blob). Sections:
// hook, opening, middle, cta, closing — each with timing, a scene reference, a voice
// note and a caption. Deterministic: derived from the story + hook + brief.

export type ScriptOptions = { story?: Story; hook?: Hook | null };

export function buildScript(brief: CreativeBriefInput, kind: AssetKind, opts: ScriptOptions = {}): Script {
  const story = opts.story ?? buildStory(brief, kind);
  const channel = ASSET_KIND_META[kind].channel;
  const hook = opts.hook !== undefined ? opts.hook : selectHook({ channel });
  const scenes = story.acts.flatMap((a) => a.scenes);

  const audience = keyPhrase(brief.audience, "founders");
  const message = keyPhrase(brief.keyMessage, "the core promise");
  const proof = keyPhrase(brief.proof, "");
  const cta = keyPhrase(brief.cta, "get started");

  const hookLine = hook
    ? renderHook(hook, { audience, product: brief.objective || "the product", pain: brief.emotionalAngle || "the busywork" })
    : `${audience}: ${message}.`;

  // Build sections with cumulative timing off the story's scene durations.
  const sections: ScriptSection[] = [];
  let t = 0;
  const push = (label: ScriptSection["label"], text: string, durationSec: number, sceneRef?: string, voiceNote?: string, caption?: string) => {
    sections.push({ label, text, startSec: t, durationSec, sceneRef, voiceNote, caption });
    t += durationSec;
  };

  const first = scenes[0];
  const last = scenes[scenes.length - 1];
  const mids = scenes.slice(1, -1);
  const midDur = mids.reduce((n, s) => n + s.durationSec, 0) || 4;

  push("hook", hookLine, first?.durationSec ?? 3, first?.id, "Punchy, high energy — earn the next 3 seconds.", hookLine);
  push("opening", `Here's what matters for ${audience}: ${message}.`, Math.max(2, Math.round((first?.durationSec ?? 3) * 0.8)), first?.id, "Warm, credible.", message);
  push("middle", proof ? `${message} — and here's the proof: ${proof}.` : `${message}. Watch how it works.`, midDur, mids[0]?.id, "Steady, demonstrate value.", proof || "how it works");
  push("cta", cta, last?.durationSec ?? 2, last?.id, "Direct, confident.", cta);
  push("closing", `That's ${brief.objective || "it"}. ${cta}.`, 2, last?.id, "Sign off on-brand.", "");

  const captions = sections.map((s) => s.caption || "").filter(Boolean);
  const voiceNotes = sections.map((s) => s.voiceNote || "").filter(Boolean);

  return {
    id: idFrom("script", story.id, kind, hook?.id ?? "nohook"),
    format: story.format,
    sections,
    captions,
    voiceNotes,
    totalDurationSec: sections.reduce((n, s) => n + s.durationSec, 0),
  };
}
