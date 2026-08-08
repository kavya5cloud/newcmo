// Recommendation telemetry.
//
// Fire-and-forget by design: this records which suggestions were shown and what the founder
// did with them, and it must never block or break the interface it is measuring. Every call
// swallows its own errors.

import { workspaceId, type Profile, type FeedEntry } from "@/lib/store";

/* ---------- intelligence dataset logging (fire-and-forget, never blocks UI) ---------- */
export function logRecBatch(
  url: string,
  profile: Profile,
  feed: Record<string, FeedEntry>
): Promise<Record<string, string>> {
  const items = Object.entries(feed).flatMap(([channel, entry]) =>
    (entry.items || []).map(([title, action], i) => ({ channel, title, action, clientKey: `${channel}:${i}` }))
  );
  if (!items.length) return Promise.resolve({});
  return fetch("/api/intel/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wsid: workspaceId(), url, profile, items }),
  })
    .then((r) => r.json())
    .then((d) => (d?.ids && typeof d.ids === "object" ? (d.ids as Record<string, string>) : {}))
    .catch(() => ({}));
}

export function logRecEvent(
  recId: string | undefined,
  event: string,
  asset?: { title: string; body: string; channel: string },
  metadata?: Record<string, unknown>
) {
  if (!recId) return;
  fetch("/api/intel/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wsid: workspaceId(), recommendationId: recId, event, asset, metadata }),
  }).catch(() => {});
}
