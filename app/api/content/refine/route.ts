import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { generateText, configuredProviderNames } from "@/lib/services/llm";
import { createAdapterRegistry } from "@/lib/social/registry";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/lib/social/types";

export const runtime = "nodejs";

// Inline refinement of a selection.
//
// Deliberately narrow: it receives the highlighted text plus a little surrounding context
// and returns a replacement for that selection only. The document is never regenerated —
// rewriting a whole post because someone wanted one sentence shortened loses their edits
// and costs a full generation.
//
// Uses the same lib/services/llm orchestration as everything else. No second AI layer.

export const REFINEMENTS = {
  rewrite: "Rewrite it. Same meaning, better sentence.",
  shorten: "Make it shorter without losing the point.",
  expand: "Expand it with one more concrete, specific detail. Do not pad.",
  improve: "Improve clarity and rhythm. Keep the author's voice.",
  professional: "Make the tone more professional. Still human, not corporate.",
  casual: "Make the tone more casual and conversational.",
  engaging: "Make it more engaging. Lead with the interesting part.",
  grammar: "Fix grammar, spelling and punctuation. Change nothing else.",
  cta: "Rewrite this as a clear call to action aimed at the reader.",
  hashtags: "Return 3-4 relevant hashtags for this text, space separated. Nothing else.",
  continue: "Continue writing from here. One or two sentences that follow naturally.",
} as const;

export type Refinement = keyof typeof REFINEMENTS;

function isRefinement(v: unknown): v is Refinement {
  return typeof v === "string" && v in REFINEMENTS;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }

  const action = body.action;
  if (!isRefinement(action)) {
    return NextResponse.json({ error: "invalid_action", hint: Object.keys(REFINEMENTS).join(" | ") }, { status: 422 });
  }

  const selection = String(body.selection ?? "").trim();
  // "continue" is the one action that legitimately starts from nothing selected.
  if (!selection && action !== "continue") {
    return NextResponse.json({ error: "missing_selection", hint: "Highlight some text first." }, { status: 422 });
  }
  if (selection.length > 4000) {
    return NextResponse.json({ error: "selection_too_long", hint: "Select a smaller passage." }, { status: 422 });
  }

  if (configuredProviderNames().length === 0) {
    return NextResponse.json(
      { error: "no_provider", hint: "No AI provider is configured, so inline edits are unavailable. Your text is unchanged." },
      { status: 503 },
    );
  }

  // Only a window of surrounding text, so the model writes something that fits where it
  // lands without being handed the whole document.
  const before = String(body.before ?? "").slice(-600);
  const after = String(body.after ?? "").slice(0, 600);

  const platform = SOCIAL_PLATFORMS.includes(body.platform as SocialPlatform)
    ? (body.platform as SocialPlatform) : null;
  const limitChars = platform ? createAdapterRegistry().get(platform)?.constraints().maxText : null;

  const prompt = [
    `You are editing one passage inside a piece of marketing copy.`,
    ``,
    before ? `TEXT BEFORE THE SELECTION:\n${before}` : "",
    `THE SELECTION${action === "continue" && !selection ? " (empty — continue from the text before)" : ""}:\n${selection}`,
    after ? `TEXT AFTER THE SELECTION:\n${after}` : "",
    ``,
    `TASK: ${REFINEMENTS[action]}`,
    ``,
    `RULES`,
    `- Return ONLY the replacement text. No preamble, no quotes, no explanation.`,
    `- Do not rewrite anything outside the selection.`,
    `- Keep every fact. Invent no numbers, customers or claims.`,
    platform ? `- This will sit in a ${platform} post${limitChars ? `, hard limit ${limitChars} characters total` : ""}.` : "",
    `- No hype adjectives, no "in today's fast-paced world".`,
  ].filter(Boolean).join("\n");

  try {
    const result = await generateText({ prompt });
    if (!result.ok) {
      return NextResponse.json(
        { error: "refine_failed", hint: "That edit didn't go through. Your text is unchanged — try again." },
        { status: 503 },
      );
    }

    // Models sometimes wrap a reply in quotes or a code fence despite being told not to.
    let text = result.text.trim()
      .replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "")
      .replace(/^["“]|["”]$/g, "")
      .trim();

    if (!text) {
      return NextResponse.json(
        { error: "empty_result", hint: "The model returned nothing. Your text is unchanged." },
        { status: 503 },
      );
    }
    // "continue" appends; everything else replaces. Guard against a model that echoes the
    // selection back with its continuation attached.
    if (action === "continue" && selection && text.startsWith(selection)) {
      text = text.slice(selection.length).trimStart();
    }

    return NextResponse.json({
      ok: true, action, text,
      provider: result.provider, model: result.model ?? null,
      // The caller keeps the original so a refinement can always be rejected.
      replaced: selection,
    });
  } catch (e) {
    return NextResponse.json({ error: "refine_failed", detail: String(e).slice(0, 150) }, { status: 503 });
  }
}
