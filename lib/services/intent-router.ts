// Deterministic intent router — the first step of every chat request.
//
// A CMO answers the question that was ASKED. "Write an X post" wants content, not a
// strategy memo. So before any LLM call we classify the message with rules (no model,
// no cost, no nondeterminism) and dispatch to the right engine. The LLM never decides
// which engine runs.

export type Intent = "content" | "edit" | "transform" | "campaign" | "analysis" | "strategy";

export type AssetKind =
  | "x_post" | "x_thread" | "linkedin_post" | "reddit_post" | "blog" | "email"
  | "landing_copy" | "ig_carousel" | "ig_reel_script" | "ig_caption" | "ugc_script"
  | "headlines" | "hooks" | "cta";

export type RoutedIntent = {
  intent: Intent;
  asset: AssetKind | null;   // what to produce (content/transform) — null if unspecified
  target: AssetKind | null;  // transform destination
};

const ASSET_PATTERNS: [AssetKind, RegExp][] = [
  ["x_thread", /\b(x|twitter|tweet)\s*thread|thread\b/i],
  ["x_post", /\b(x|twitter)\s*(post|update)|\btweet\b|post on x\b/i],
  ["linkedin_post", /\blinked ?in\b/i],
  ["reddit_post", /\breddit|subreddit|r\/\w+/i],
  ["ig_carousel", /\bcarousel\b/i],
  ["ig_reel_script", /\breel|tiktok|short(?:\s*video)?\b/i],
  ["ig_caption", /\b(instagram|ig)\s*caption|caption\b/i],
  ["ugc_script", /\bugc\b|talking[-\s]?head|creator script/i],
  ["landing_copy", /\blanding\s*page|hero\s*copy|landing copy\b/i],
  ["email", /\bemail|newsletter\b/i],
  ["blog", /\bblog|article|long[-\s]?form\b/i],
  ["headlines", /\bheadlines?\b/i],
  ["hooks", /\bhooks?\b/i],
  ["cta", /\bctas?|call[-\s]?to[-\s]?action\b/i],
];

function detectAsset(text: string): AssetKind | null {
  for (const [kind, re] of ASSET_PATTERNS) if (re.test(text)) return kind;
  return null;
}

/**
 * Whether the founder is asking rather than commissioning.
 *
 * Either an interrogative opener or a trailing question mark counts. Deliberately generous:
 * mistaking a content request for a question costs one clarifying reply, while mistaking a
 * question for a content request hands back a whole asset nobody asked for.
 */
function isQuestion(text: string): boolean {
  return /\?\s*$/.test(text)
    || /^\s*(how|what|whats|what's|why|when|where|which|who|whom|should|shall|is|are|was|were|do|does|did|can|could|would|will|am|any|got|anyone)\b/i.test(text);
}

// Ordered most-specific → most-general. First match wins.
const RULES: { intent: Intent; re: RegExp }[] = [
  // Transform: convert existing content into another format.
  { intent: "transform", re: /\b(turn|convert|repurpose|remix|adapt|reformat)\b[^.]*\b(into|to|as)\b|make (this|it|that) (a |an )?(thread|carousel|reel|blog|email|newsletter|linkedin|post)/i },
  // Edit: operate on supplied/previous content, don't regenerate from scratch.
  { intent: "edit", re: /\b(make (it|this|that)|rewrite|reword|rephrase|revise|shorten|lengthen|tighten|punch it up|simplify|change the (cta|hook|headline|tone|ending)|fix (the|this)|polish (it|this)|trim (it|this|the))\b/i },
  // Content: generate a fresh asset.
  { intent: "content", re: /\b(write|create|generate|draft|give me|make me|compose|come up with)\b[^.]*\b(post|thread|tweet|caption|blog|article|email|newsletter|reply|comment|copy|headline|hook|cta|script|carousel|reel|ad)\b|\bsomething to post\b|\bdraft (a|an|some)\b/i },
  // Campaign: multi-asset plan / growth goal.
  { intent: "campaign", re: /\b(launch|campaign|go[-\s]?to[-\s]?market|plan (a|my|the)|roadmap)\b|i want (more|to get) (users|customers|signups|sign-ups|traffic|growth|leads)|\bgo viral\b|grow my (business|audience|traffic)/i },
  // Analysis: diagnose / explain / what worked.
  { intent: "analysis", re: /\b(why (is|are|did|has)|analy[sz]e|diagnos|what (worked|happened|changed)|explain the|breakdown|deep[-\s]?dive|compare|competitor)\b/i },
  // Strategy: what should I do / where / prioritization. (Also the default.)
  { intent: "strategy", re: /\b(what should i|should i|where (should|do) i|which channel|worth it|prioriti[sz]e|focus on|best (way|channel)|next step|how do i grow)\b/i },
];

/**
 * Classify a message into an intent + (optional) asset target. Deterministic, no LLM.
 * `hasSelection` = the user is acting on a specific existing asset (from the editor/graph),
 * which strengthens edit/transform even when the wording is terse ("shorter", "as a thread").
 */
export function routeIntent(message: string, hasSelection = false): RoutedIntent {
  const text = (message || "").trim();
  const asset = detectAsset(text);

  // With a concrete selection, terse edit/transform verbs shouldn't fall through to content.
  if (hasSelection) {
    if (/\b(into|to|as)\b|\bthread|carousel|reel|linkedin|blog|newsletter\b/i.test(text) && /\b(turn|convert|make|repurpose|as)\b/i.test(text)) {
      return { intent: "transform", asset, target: asset };
    }
    if (/\b(shorter|longer|bolder|punchier|funnier|formal|casual|tighten|rewrite|reword|change|fix|simplif|edit)\b/i.test(text)) {
      return { intent: "edit", asset, target: null };
    }
  }

  // A clear create-verb + content noun is content, even if an adjective ("polished",
  // "short") would otherwise look like an edit. This must beat the edit rule below.
  const contentVerb = /\b(write|create|generate|draft|compose|come up with|give me|make me)\b/i;
  const contentNoun = /\b(post|thread|tweet|caption|blog|article|email|newsletter|reply|comment|copy|headlines?|hooks?|ctas?|script|carousel|reel|ad|landing)\b/i;
  if (contentVerb.test(text) && (asset || contentNoun.test(text))) {
    return { intent: "content", asset, target: null };
  }

  for (const { intent, re } of RULES) {
    if (re.test(text)) {
      if (intent === "transform") return { intent, asset, target: asset };
      return { intent, asset, target: null };
    }
  }

  // Unmatched.
  //
  // A bare asset noun used to be enough to trigger generation, which produced the single
  // most absurd behaviour in the product: "how long should a LinkedIn post be?" matched
  // `linkedin`, found no rule, fell through here, and answered with a LinkedIn post. So did
  // "any tips for blog SEO?" — a whole blog draft instead of the tip. The founder asked a
  // question and got a deliverable.
  //
  // A noun is only a request to produce something when nobody is asking a question. Every
  // genuine content ask still routes above, on the create verb ("write me a LinkedIn post"),
  // which is where it belongs — including when it is phrased as one ("can you write…").
  if (asset && !isQuestion(text)) return { intent: "content", asset, target: null };
  return { intent: "strategy", asset: null, target: null };
}

export const ASSET_LABEL: Record<AssetKind, string> = {
  x_post: "X post", x_thread: "X thread", linkedin_post: "LinkedIn post",
  reddit_post: "Reddit post", blog: "blog draft", email: "email",
  landing_copy: "landing page copy", ig_carousel: "Instagram carousel",
  ig_reel_script: "Instagram reel script", ig_caption: "Instagram caption",
  ugc_script: "UGC script", headlines: "headline set", hooks: "hook set", cta: "CTA variations",
};
