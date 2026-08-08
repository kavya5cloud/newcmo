import type { CmoContext } from "@/lib/services/cmo-context";
import { HONESTY_RULES } from "@/lib/cmo/quality-rules";

// Editor Engine — NEVER regenerates. It applies the requested change to the supplied
// content and returns the edited version only. If no source content is available it says
// so (the client should route to the Content Engine instead).

export function buildEditPrompt(ctx: CmoContext, instruction: string, source: string): string {
  return `You are an editor for ${ctx.business.name || "this brand"}. Apply the requested change to the content below and return ONLY the edited content.

Voice: ${ctx.business.voice || "keep the existing voice"}.

Rules:
- Edit — do NOT rewrite from scratch or change the core message unless asked.
- Preserve format and length unless the instruction changes it.
- Output ONLY the edited content. No commentary, no "here's the edit".
${HONESTY_RULES}

Change requested: ${instruction}

--- CONTENT TO EDIT ---
${source}
--- END ---`;
}
