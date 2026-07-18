import type { CmoContext } from "@/lib/services/cmo-context";
import type { DecisionArtifact, EvidencePack } from "@/lib/cmo/contracts";

// ============================================================================
// Response Renderer — Populr's AI CMO conversation layer.
//
// The reasoning pipeline (assemble → project graph → decide → classify) produces a
// DecisionArtifact + EvidencePack. THIS layer owns presentation only: tone, structure,
// length, and follow-ups. It turns the decision into the voice of an experienced VP
// Marketing — and it never lets an internal artifact (Decision/Trade-off/Evidence/
// Confidence/IDs/graph terms) reach the founder. Reasoning stays untouched.
// ============================================================================

const PERSONA = `You are Populr's AI CMO — the permanent head of marketing for this specific business, with the judgment of a VP Marketing from Stripe, Notion, Airbnb, or Linear. You own this company's growth; you are not a general assistant.

Voice: strategic, confident, calm, concise, opinionated, business-first, evidence-driven. You are NOT verbose, robotic, generic, apologetic, prompt-like, or educational unless explicitly asked.`;

const RULES = `How you speak:
- Answer the founder's question first, directly.
- Weave what you know about the business into normal sentences — never present it as a report.
- NEVER print labels or section headers such as "Decision:", "Recommendation:", "Trade-off:", "Evidence:", "Confidence:", "Ranked options:", "Uncertainty:", "Next steps:", "Intent:", or "Status:". No structured dumps.
- Never mention internal IDs, internal task names, confidence scores, or any system/graph terminology. These are implementation details the founder must never see.
- When you give advice: state the recommendation in a sentence, explain why in a sentence or two using the real evidence, then name the single next action — as flowing prose, not a list.
- Be concise: a few short paragraphs at most. No filler.
- Ask a follow-up question only when you genuinely need one thing to answer well. Never tack on a generic "What would you like to do next?".`;

/** The business facts, as VALUES only (no internal ids/kinds/structure). */
function knownFacts(evidence: EvidencePack): string {
  const facts = Object.values(evidence).flat();
  if (!facts.length) return "- (you know very little about this business yet)";
  return facts.map((f) => `- ${f.label}: ${f.value}`).join("\n");
}

/**
 * Build the final conversational prompt for a reasoning-bearing turn (strategy/campaign/
 * analysis or a general question). The decision is provided as *advisory* guidance the
 * model expresses in its own voice — and only when the founder is actually asking for
 * direction, so "Who are you?" stays an identity answer, not a channel pitch.
 */
export function renderCmoPrompt(input: {
  context: CmoContext;
  decision: DecisionArtifact;
  evidence: EvidencePack;
  question: string;
  recentTurns?: string;
}): string {
  const { context, decision, evidence, question, recentTurns } = input;
  const brand = context.business.name || "this business";

  let guidance: string;
  if (decision.status === "recommended") {
    const top = decision.rankedOptions[0];
    guidance = `If (and only if) the founder is asking what to do or where to focus, your considered view — express it in your own words, never quote it — is: ${decision.recommendation}${top ? ` The strongest direction is ${top.action.toLowerCase()}.` : ""}${decision.nextAction ? ` A sensible first move is to ${decision.nextAction.replace(/^Execute:\s*/i, "").toLowerCase()}.` : ""} If they're asking something else (who you are, a definition, a fact about their business), just answer that directly as their CMO.`;
  } else if (decision.status === "needs_clarification") {
    guidance = `You need one specific thing to answer well: ${decision.uncertainty.missing.join(", ") || "a little more detail"}. Ask for it in one natural sentence, then give your best provisional take anyway.`;
  } else {
    guidance = `You don't have enough grounding on ${brand} yet to give a real recommendation. Say so plainly and warmly, and point them to the one thing that would let you help — analyzing their site, or connecting Search Console. Do not invent specifics.`;
  }

  return `${PERSONA}

What you know about ${brand} (use it naturally; never list it back):
${knownFacts(evidence)}

${guidance}

${RULES}
${recentTurns ? `\nRecent conversation:\n${recentTurns}\n` : ""}
The founder says: ${question}`;
}

// A leading artifact label at the start of a line (with optional markdown bold/emphasis).
const ARTIFACT_LABEL = /^\s*(?:[*_#>\-\s]+)?(decision|recommendation|trade[-\s]?offs?|evidence|confidence|ranked options?|options?|uncertainty|next steps?|next action|intent|status|reasoning|analysis)\s*[:\-—]\s*(?:\*+|_+)?\s*/i;

/**
 * Presentation safety net: even if the model leaks structure, the founder never sees it.
 * Strips leading artifact labels (keeping any real content after them), internal evidence
 * IDs, and system/graph terminology. Conservative — it won't touch ordinary prose.
 */
export function sanitizeCmoText(text: string): string {
  if (!text) return text;
  const out = text
    .split("\n")
    .map((line) => line.replace(ARTIFACT_LABEL, ""))
    .join("\n")
    .replace(/\bev\d+\b/g, "")
    .replace(/\b(EvidencePack|DecisionArtifact|BusinessGraph|graph version|evidence pack|decision artifact)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}
