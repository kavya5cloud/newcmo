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
export type ChatMsg = { who: "ai" | "me"; text: string };
export type FeedEntry = { summary: string; items: [string, string][] };
export type Ranking = { pos: string; query: string; trend: string };

export type Saved = {
  url: string;
  profile: Profile | null;
  competitors: { n: string; c: string }[];
  chat: ChatMsg[];
  drafts: Draft[];
  feed?: Record<string, FeedEntry>;
  rankings?: Ranking[];
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
