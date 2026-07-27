// UGC workflow contracts.
//
// UGC is the one content type Populr could describe but not produce: the studio had a UGC
// section with a "Soon" badge. This layer makes it real — hooks, scripts, testimonials,
// demo scripts, creator and voice styles, CTAs, versions — and hands the result to the
// existing Draft Manager and Publishing Engine rather than growing its own.

export const UGC_FORMATS = ["testimonial", "product_demo", "unboxing", "day_in_life", "problem_solution", "comparison"] as const;
export type UgcFormat = (typeof UGC_FORMATS)[number];

export const FORMAT_META: Record<UgcFormat, { label: string; blurb: string; seconds: number }> = {
  testimonial: { label: "Testimonial", blurb: "A real user explaining the change, not the feature.", seconds: 30 },
  product_demo: { label: "Product demo", blurb: "Show the thing working, in one take.", seconds: 45 },
  unboxing: { label: "First impression", blurb: "The first ninety seconds of using it.", seconds: 40 },
  day_in_life: { label: "Day in the life", blurb: "The product inside a real workflow.", seconds: 50 },
  problem_solution: { label: "Problem → solution", blurb: "Name the pain, then resolve it on camera.", seconds: 35 },
  comparison: { label: "Before / after", blurb: "The old way against the new one.", seconds: 35 },
};

/** How the creator comes across. Changes the writing, not just a label. */
export const CREATOR_STYLES = ["founder", "power_user", "skeptic", "expert", "newcomer"] as const;
export type CreatorStyle = (typeof CREATOR_STYLES)[number];

export const CREATOR_STYLE_META: Record<CreatorStyle, { label: string; stance: string }> = {
  founder: { label: "Founder", stance: "Speaks from having built it — direct, specific, no marketing gloss." },
  power_user: { label: "Power user", stance: "Deep in the workflow; leads with the trick nobody else knows." },
  skeptic: { label: "Won-over skeptic", stance: "Opens with the objection, then shows what changed their mind." },
  expert: { label: "Practitioner", stance: "Frames it against how the job is normally done." },
  newcomer: { label: "First-timer", stance: "Relatable confusion resolved on camera — good for wide reach." },
};

export const VOICE_STYLES = ["calm", "energetic", "conversational", "authoritative", "warm"] as const;
export type VoiceStyle = (typeof VOICE_STYLES)[number];

export const VOICE_STYLE_META: Record<VoiceStyle, { label: string; direction: string }> = {
  calm: { label: "Calm", direction: "Even pace, no hype. Let the product carry it." },
  energetic: { label: "Energetic", direction: "Fast cuts, rising delivery. Best for short vertical formats." },
  conversational: { label: "Conversational", direction: "Like explaining it to a friend. Contractions, pauses, imperfection." },
  authoritative: { label: "Authoritative", direction: "Measured and precise. Earns trust on substance." },
  warm: { label: "Warm", direction: "Personal and unhurried. Good for testimonial and story formats." },
};

export type UgcBrief = {
  product: string;
  audience: string;
  /** The change the product creates — what the video is actually about. */
  outcome: string;
  format: UgcFormat;
  creatorStyle: CreatorStyle;
  voiceStyle: VoiceStyle;
  /** Optional objection to address head-on. */
  objection?: string;
  platform?: string;
};

export type Hook = {
  id: string;
  text: string;
  /** Why this hook should stop a scroll — stated, so it can be argued with. */
  rationale: string;
  /** 0..1 — derived from format fit and specificity, not a flourish. */
  strength: number;
};

export type ScriptScene = {
  index: number;
  /** Seconds from the start of the video. */
  at: number;
  /** What is said. */
  line: string;
  /** What is on screen. */
  visual: string;
};

export type Cta = { id: string; text: string; kind: "soft" | "direct" | "curiosity" };

export type UgcVersion = {
  id: string;
  label: string;
  hook: Hook;
  scenes: ScriptScene[];
  cta: Cta;
  creatorStyle: CreatorStyle;
  voiceStyle: VoiceStyle;
  /** Direction for whoever (or whatever) shoots it. */
  voiceDirection: string;
  durationSeconds: number;
  wordCount: number;
  /** Body copy for the post that carries the video. */
  caption: string;
  hashtags: string[];
  status: "draft" | "approved" | "rejected";
};

export type UgcPackage = {
  id: string;
  tenant: string;
  brief: UgcBrief;
  versions: UgcVersion[];
  hooks: Hook[];
  ctas: Cta[];
  createdAt: number;
  updatedAt: number;
};

export type UgcRecord = UgcPackage;
