// Client persistence: localStorage is the source of truth (survives refresh),
// with best-effort sync to Neon via /api/state when DATABASE_URL is configured.

export type Profile = {
  name: string;
  oneLiner: string;
  audience: string;
  positioning: string;
  competitors: string[];
  voice: string;
  description: string;
};

export type Draft = {
  id: string;
  title: string;
  channel: string;
  body: string;
  approved: boolean;
  approvedAt?: string;
  published?: boolean;
  /** Intelligence-dataset recommendation UUID, stamped at draft creation so later
   *  approve/publish events can never mislink after a re-analysis replaces the map. */
  recId?: string;
};
/**
 * A thing the CMO offered to do, attached to the message that offered it.
 *
 * Carried on the message rather than held as one "pending action" on the page, because a
 * founder can ask three things in a row and each answer keeps its own offer. A single
 * pending slot would silently replace the first two.
 */
export type ChatAction = {
  /** The deterministic intent the command parser found. */
  intent: string;
  /** What will happen, restated before it happens. */
  summary: string;
  /** The original instruction, re-sent verbatim to execute. */
  text: string;
  /** Set once it has run, so an offer cannot be taken twice. */
  ran?: string;
};

export type ChatMsg = { who: "ai" | "me"; text: string; intent?: string; action?: ChatAction };
export type FeedEntry = { summary: string; items: [string, string][] };
// Removed: Ranking. It typed a shape only the dashboard's Top queries panel used, and that
// panel now shows Search Console data or nothing. The type's last job was carrying guessed
// Google positions between a prompt and a UI, so it goes with them.

export type Saved = {
  url: string;
  profile: Profile | null;
  competitors: { n: string; c: string }[];
  chat: ChatMsg[];
  drafts: Draft[];
  feed?: Record<string, FeedEntry>;
  /** When `feed` was generated. Without it a saved feed is treated as stale, because it
   *  predates the rotation and would otherwise freeze the board forever. */
  feedAt?: number;
  docs?: Record<string, string>;
  estTraffic?: { impressions: number; clicks: number; visits: number } | null;
  gscSite?: string | null;
  /** clientKey ("channel:index") → recommendation UUID in the intelligence dataset. */
  recIds?: Record<string, string>;
};

const LS_KEY = "cosmos.state";
const WS_KEY = "cosmos.wsid";

export function workspaceId(): string {
  if (typeof window === "undefined") return "server";
  let id = localStorage.getItem(WS_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || String(Math.random()).slice(2)) as string;
    localStorage.setItem(WS_KEY, id);
  }
  return id;
}

export function loadLocal(): Saved | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

export function saveLocal(s: Saved) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
}

// Load from Neon if available; falls back to localStorage. Returns {saved, cloud}.
export async function loadState(): Promise<{ saved: Saved | null; cloud: boolean }> {
  try {
    const r = await fetch(`/api/state?wsid=${encodeURIComponent(workspaceId())}`);
    if (r.ok) {
      const d = await r.json();
      if (d.enabled && d.state) return { saved: d.state as Saved, cloud: true };
      if (d.enabled) return { saved: loadLocal(), cloud: true };
    }
  } catch {
    /* server unreachable — use local */
  }
  return { saved: loadLocal(), cloud: false };
}

let t: ReturnType<typeof setTimeout> | null = null;
export function saveState(s: Saved) {
  saveLocal(s);
  if (t) clearTimeout(t);
  t = setTimeout(() => {
    fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wsid: workspaceId(), state: s }),
    }).catch(() => {});
  }, 600);
}
