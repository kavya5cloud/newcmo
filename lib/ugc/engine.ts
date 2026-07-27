import { createHash } from "node:crypto";
import {
  CREATOR_STYLE_META, FORMAT_META, VOICE_STYLE_META,
  type CreatorStyle, type Cta, type Hook, type ScriptScene,
  type UgcBrief, type UgcPackage, type UgcVersion, type VoiceStyle,
} from "./types";

// The UGC engine. Deterministic: the same brief always produces the same package, so a
// version a founder approved is the version that ships, and the whole thing is testable
// without a model call.
//
// The writing is assembled from the brief's own words — product, audience, outcome,
// objection — rather than from stock marketing lines. A script that doesn't mention what
// the product actually does is worthless, however fluent it sounds.

function id(prefix: string, ...parts: unknown[]): string {
  return prefix + "_" + createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 12);
}

const clamp = (n: number) => Math.max(0, Math.min(1, Number(n.toFixed(3))));
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Trim a phrase to something sayable on camera. */
function sayable(s: string, max = 14): string {
  const w = s.trim().split(/\s+/).filter(Boolean);
  return w.length <= max ? w.join(" ") : w.slice(0, max).join(" ") + "…";
}

// ---- Hooks ----

type HookTemplate = { build: (b: UgcBrief) => string; why: string; base: number; needsObjection?: boolean };

const HOOK_TEMPLATES: HookTemplate[] = [
  {
    build: (b) => `I stopped ${sayable(b.outcome.replace(/^(get|getting|to)\s+/i, ""), 8)} the hard way.`,
    why: "Leads with a change of behaviour, not a product name — the viewer sees themselves before they see an ad.",
    base: 0.72,
  },
  {
    build: (b) => `If you're ${sayable(b.audience, 6)}, this is the part nobody tells you.`,
    why: "Names the audience out loud in the first second, so the right people stay and the wrong ones scroll.",
    base: 0.68,
  },
  {
    build: (b) => `${sayable(b.objection ?? "", 10)} — that's what I thought too.`,
    why: "Opens on the objection itself, which disarms the viewer already thinking it.",
    base: 0.78,
    needsObjection: true,
  },
  {
    build: (b) => `Here's what ${sayable(b.product, 5)} actually does in thirty seconds.`,
    why: "Promises a specific, bounded payoff. Works when the product is hard to explain in text.",
    base: 0.62,
  },
  {
    build: (b) => `The difference between doing this manually and ${sayable(b.outcome, 8)}.`,
    why: "Frames the video as a comparison, which sets up the before/after the script then delivers.",
    base: 0.65,
  },
];

/** Format changes which hooks land, so the ranking is format-aware, not universal. */
const FORMAT_HOOK_BONUS: Partial<Record<UgcBrief["format"], number[]>> = {
  testimonial: [0.08, 0.04, 0.1, 0, 0.02],
  problem_solution: [0.06, 0.02, 0.12, 0.02, 0.08],
  comparison: [0.02, 0, 0.04, 0.04, 0.14],
  product_demo: [0, 0.02, 0.02, 0.14, 0.06],
};

export function generateHooks(brief: UgcBrief, limit = 5): Hook[] {
  const bonus = FORMAT_HOOK_BONUS[brief.format] ?? [];
  return HOOK_TEMPLATES
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !t.needsObjection || Boolean(brief.objection?.trim()))
    .map(({ t, i }) => {
      const text = t.build(brief);
      // Specificity earns confidence: a hook carrying real nouns from the brief beats a
      // generic one, and that is measurable rather than asserted.
      const specific = /[A-Za-z]{4,}/.test(brief.outcome) && words(text) >= 6 ? 0.06 : 0;
      return {
        id: id("hook", brief.product, brief.format, i, text),
        text,
        rationale: t.why,
        strength: clamp(t.base + (bonus[i] ?? 0) + specific),
      };
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, limit);
}

// ---- CTAs ----

export function generateCtas(brief: UgcBrief): Cta[] {
  const product = sayable(brief.product, 4);
  return [
    { id: id("cta", product, "soft"), text: `Link's in the bio if you want to try ${product}.`, kind: "soft" as const },
    { id: id("cta", product, "direct"), text: `Start free — takes about a minute.`, kind: "direct" as const },
    { id: id("cta", product, "curiosity"), text: `I'll show the rest of the workflow in the next one.`, kind: "curiosity" as const },
  ];
}

// ---- Scripts ----

/** Scene beats per format. Each returns lines built from the brief, not filler. */
const SCENE_PLANS: Record<UgcBrief["format"], (b: UgcBrief, hook: Hook) => { line: string; visual: string }[]> = {
  testimonial: (b, h) => [
    { line: h.text, visual: "Face to camera, handheld, no intro card." },
    { line: `I'm ${sayable(b.audience, 6)} and ${sayable(b.outcome, 10)} used to take me most of a day.`, visual: "Cut to the old way — messy tabs, notes, spreadsheet." },
    { line: `Now I use ${sayable(b.product, 5)} for it.`, visual: "Screen recording, one real task, no speed-up." },
    { line: `The part that changed things: ${sayable(b.outcome, 12)}.`, visual: "Hold on the result on screen." },
  ],
  product_demo: (b, h) => [
    { line: h.text, visual: "Straight into the screen recording — no talking head." },
    { line: `This is the actual thing, not a mockup.`, visual: "Cursor moving through the real product." },
    { line: `Watch what happens when I ${sayable(b.outcome, 10)}.`, visual: "One unbroken take of the core action." },
    { line: `That's the whole flow.`, visual: "End on the finished output, full screen." },
  ],
  unboxing: (b, h) => [
    { line: h.text, visual: "First open — signup screen, unedited." },
    { line: `First thing I noticed as ${sayable(b.audience, 6)}:`, visual: "Point at the one thing that stands out." },
    { line: `Ninety seconds in, ${sayable(b.outcome, 10)}.`, visual: "Timer overlay, real elapsed time." },
    { line: `That's further than I got with the last three I tried.`, visual: "Result on screen." },
  ],
  day_in_life: (b, h) => [
    { line: h.text, visual: "Morning, desk, real environment." },
    { line: `Most of my day as ${sayable(b.audience, 6)} is this.`, visual: "The repetitive work, sped up." },
    { line: `${sayable(b.product, 5)} takes that part.`, visual: "Hand off the task on screen." },
    { line: `Which is how ${sayable(b.outcome, 10)}.`, visual: "End of day, the thing finished." },
  ],
  problem_solution: (b, h) => [
    { line: h.text, visual: "Close on the frustrating moment." },
    { line: b.objection ? `Everyone says ${sayable(b.objection, 10)}.` : `The problem isn't effort, it's the process.`, visual: "Show the failure state clearly." },
    { line: `Here's the fix: ${sayable(b.product, 5)}.`, visual: "Cut to the product doing the one job." },
    { line: `Same task, ${sayable(b.outcome, 10)}.`, visual: "Before and after side by side." },
  ],
  comparison: (b, h) => [
    { line: h.text, visual: "Split screen set-up shot." },
    { line: `Left is how I used to do it.`, visual: "The manual process, real time." },
    { line: `Right is ${sayable(b.product, 5)}.`, visual: "Same task in the product." },
    { line: `${sayable(b.outcome, 12)}.`, visual: "Both results on screen together." },
  ],
};

/** Style rewrites the opening line rather than tagging it — voice has to be audible. */
function applyCreatorStyle(line: string, style: CreatorStyle, brief: UgcBrief): string {
  switch (style) {
    // Prepend a whole sentence rather than splicing into the hook: lowercasing the first
    // character mangles acronyms ("AI" → "aI"), and the hook is the line that has to land.
    case "founder": return `I built ${sayable(brief.product, 4)}. ${line}`;
    case "skeptic": return `I didn't think this would work. ${line}`;
    case "expert": return `I've done this job for years. ${line}`;
    case "newcomer": return `I'd never done this before. ${line}`;
    case "power_user": return `${line} And there's a shortcut most people miss.`;
  }
}

export function generateScript(brief: UgcBrief, hook: Hook): ScriptScene[] {
  const beats = SCENE_PLANS[brief.format](brief, hook);
  const total = FORMAT_META[brief.format].seconds;
  const per = total / beats.length;
  return beats.map((b, i) => ({
    index: i,
    at: Math.round(i * per),
    line: i === 0 ? applyCreatorStyle(b.line, brief.creatorStyle, brief) : b.line,
    visual: b.visual,
  }));
}

// ---- Captions + hashtags ----

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim().split(/\s+/).slice(0, 2).join("");
}

export function generateHashtags(brief: UgcBrief, limit = 6): string[] {
  const from = [brief.product, brief.audience, brief.outcome, brief.format.replace(/_/g, " ")];
  const tags = from.flatMap((s) => s.split(/\s+/).filter((w) => w.length > 3).slice(0, 2)).map((w) => `#${slug(w)}`);
  return [...new Set(tags)].filter((t) => t.length > 2).slice(0, limit);
}

function caption(brief: UgcBrief, hook: Hook, cta: Cta): string {
  return `${hook.text}\n\n${brief.outcome} — for ${brief.audience}.\n\n${cta.text}`;
}

// ---- Versions ----

/** Style pairs used to vary versions. Each is a genuinely different read, not a relabel. */
const VARIATION_MATRIX: { creator: CreatorStyle; voice: VoiceStyle }[] = [
  { creator: "founder", voice: "calm" },
  { creator: "skeptic", voice: "conversational" },
  { creator: "power_user", voice: "energetic" },
  { creator: "expert", voice: "authoritative" },
  { creator: "newcomer", voice: "warm" },
];

export function buildVersion(brief: UgcBrief, hook: Hook, cta: Cta, label: string): UgcVersion {
  const scenes = generateScript(brief, hook);
  const spoken = scenes.map((s) => s.line).join(" ");
  return {
    id: id("ugcv", brief.product, brief.format, hook.id, cta.id, label),
    label,
    hook,
    scenes,
    cta,
    creatorStyle: brief.creatorStyle,
    voiceStyle: brief.voiceStyle,
    voiceDirection: `${VOICE_STYLE_META[brief.voiceStyle].direction} ${CREATOR_STYLE_META[brief.creatorStyle].stance}`,
    durationSeconds: FORMAT_META[brief.format].seconds,
    wordCount: words(spoken),
    caption: caption(brief, hook, cta),
    hashtags: generateHashtags(brief),
    status: "draft",
  };
}

/**
 * Generate a full UGC package: ranked hooks, CTA options, and N versions that differ in
 * creator and voice style — so a founder picks a read, not a synonym.
 */
export function generateUgc(tenant: string, brief: UgcBrief, opts: { versions?: number; now?: number } = {}): UgcPackage {
  const now = opts.now ?? Date.now();
  const count = Math.max(1, Math.min(5, opts.versions ?? 3));
  const hooks = generateHooks(brief);
  const ctas = generateCtas(brief);

  const versions: UgcVersion[] = [];
  for (let i = 0; i < count; i++) {
    const variation = VARIATION_MATRIX[i % VARIATION_MATRIX.length];
    // The first version keeps the brief's own styles — the founder asked for those.
    const v: UgcBrief = i === 0 ? brief : { ...brief, creatorStyle: variation.creator, voiceStyle: variation.voice };
    versions.push(buildVersion(
      v,
      hooks[i % hooks.length],
      ctas[i % ctas.length],
      i === 0 ? "As briefed" : `${CREATOR_STYLE_META[v.creatorStyle].label} · ${VOICE_STYLE_META[v.voiceStyle].label}`,
    ));
  }

  return {
    id: id("ugc", tenant, brief.product, brief.format, brief.audience, count),
    tenant, brief, versions, hooks, ctas, createdAt: now, updatedAt: now,
  };
}

/** Approve or reject one version. Pure — the package is versioned, never overwritten. */
export function decideVersion(pkg: UgcPackage, versionId: string, status: "approved" | "rejected", now = Date.now()): UgcPackage {
  return {
    ...pkg,
    versions: pkg.versions.map((v) => (v.id === versionId ? { ...v, status } : v)),
    updatedAt: now,
  };
}

/** Edit a version's caption or a script line. Pure. */
export function editVersion(
  pkg: UgcPackage,
  versionId: string,
  patch: { caption?: string; scenes?: { index: number; line?: string; visual?: string }[] },
  now = Date.now(),
): UgcPackage {
  return {
    ...pkg,
    versions: pkg.versions.map((v) => {
      if (v.id !== versionId) return v;
      const scenes = patch.scenes
        ? v.scenes.map((s) => {
          const p = patch.scenes!.find((x) => x.index === s.index);
          return p ? { ...s, line: p.line ?? s.line, visual: p.visual ?? s.visual } : s;
        })
        : v.scenes;
      const next = { ...v, caption: patch.caption ?? v.caption, scenes };
      return { ...next, wordCount: words(scenes.map((s) => s.line).join(" ")) };
    }),
    updatedAt: now,
  };
}
