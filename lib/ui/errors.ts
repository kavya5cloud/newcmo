// User-facing error language.
//
// API error codes are for logs. A person gets a sentence that says what happened and what
// to do about it — a raw code on screen is the clearest possible sign that nobody read
// the screen before shipping it.
//
// One map, used by every surface, so "rate_limited" cannot read one way in the composer
// and another in the launch workspace.

const MESSAGES: Record<string, string> = {
  // Throttling
  rate_limited: "You're going faster than we can keep up. Give it a minute and try again.",

  // Input
  missing_prompt: "Write what you want to create first.",
  prompt_too_long: "That's too long — trim it to a sentence or two.",
  missing_text: "There's nothing to send yet.",
  text_too_long: "That's too long. Shorten it and try again.",
  invalid_format: "That format isn't supported.",
  bad_request: "Something in that request didn't look right. Try again.",
  missing_selection: "Highlight some text first.",
  selection_too_long: "Select a smaller passage.",

  // Setup and connections
  no_platforms: "Connect a platform in Cross-Post before publishing.",
  no_provider: "No AI provider is configured, so this is unavailable. Your work is unchanged.",
  no_api_key: "No AI provider is configured yet. Add a key to enable generation.",
  no_key: "This workspace isn't set up yet. Paste your website to get started.",
  no_database: "Storage isn't available right now, so this can't be saved.",
  not_found: "That's no longer there — it may have been removed.",

  // Permissions and state
  unauthorized: "You need to be signed in to do that.",
  not_approved: "Approve it first, then send it to drafts.",
  illegal_transition: "That isn't possible from its current state.",
  emergency_stopped: "Emergency stop is on. Clear it before running anything.",
  state_unavailable: "Your progress couldn't be loaded just now. Nothing was lost — try again.",
  save_failed: "That didn't save. Nothing was lost — try again.",

  // Generation
  compose_failed: "Generation didn't go through. Your prompt is still here — try again.",
  refine_failed: "That edit didn't go through. Your text is unchanged — try again.",
  empty_result: "Nothing came back. Your text is unchanged — try again.",
  research_failed: "The market scan didn't finish. Try again in a moment.",
  ugc_failed: "Generating those scripts didn't work. Try again.",
  brief_failed: "Today's brief couldn't be assembled. Refresh to try again.",
  control_failed: "That action didn't go through. Try again.",
  cron_failed: "The scheduled run didn't finish. It will retry on its own.",
};

/** What a person should see when a request fails. Never a code, never a stack. */
export function humanError(
  payload: { error?: string; hint?: string } | null | undefined,
  status?: number,
): string {
  // A route-supplied hint is written for this exact situation, so it wins.
  if (payload?.hint) return payload.hint;
  if (payload?.error && MESSAGES[payload.error]) return MESSAGES[payload.error];

  if (status === 429) return MESSAGES.rate_limited;
  if (status === 401 || status === 403) return MESSAGES.unauthorized;
  if (status === 404) return MESSAGES.not_found;
  if (status && status >= 500) return "Something went wrong on our side. Nothing was lost — try again.";
  return "That didn't work. Nothing was lost — try again.";
}

/** For a thrown exception, where there is no payload at all. */
export function humanThrow(e: unknown): string {
  const s = String(e);
  if (/fetch|network|Failed to fetch/i.test(s)) return "Network error — check your connection and try again.";
  if (/abort/i.test(s)) return "That was cancelled.";
  return "Something went wrong. Nothing was lost — try again.";
}
