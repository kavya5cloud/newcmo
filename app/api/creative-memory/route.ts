import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import {
  memoryEntry, searchMemory, MEMORY_SEED, NeonCreativeMemoryStore, InMemoryCreativeMemoryStore, MEMORY_KINDS,
} from "@/lib/creative-intelligence";
import type { MemoryKind, MemoryQuery } from "@/lib/creative-intelligence";
import type { CreativeChannel } from "@/lib/creative/taxonomy";

export const runtime = "nodejs";

const memFallback = new InMemoryCreativeMemoryStore();

// Creative Memory API — search + record reusable winning patterns (hooks, CTAs, story
// structures, colors, layouts, characters, video/motion styles, headlines, openings).
// Searchable + versioned.
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 60 : 20, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const p = req.nextUrl.searchParams;
  const kind = p.get("kind");
  const q: MemoryQuery = {
    kind: kind && (MEMORY_KINDS as readonly string[]).includes(kind) ? (kind as MemoryKind) : undefined,
    channel: (p.get("channel") as CreativeChannel) || undefined,
    text: p.get("q") || undefined,
    audience: p.get("audience") || undefined,
  };
  const sql = db();
  if (sql) {
    const results = await new NeonCreativeMemoryStore(sql).search(q, Math.min(20, Number(p.get("limit")) || 8));
    return NextResponse.json({ ok: true, kinds: MEMORY_KINDS, results });
  }
  // No DB: search the deterministic seed so the endpoint is always useful.
  return NextResponse.json({ ok: true, kinds: MEMORY_KINDS, results: searchMemory(MEMORY_SEED, q, Math.min(20, Number(p.get("limit")) || 8)) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 30 : 10, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const kind = String(body.kind || "");
  if (!(MEMORY_KINDS as readonly string[]).includes(kind)) return NextResponse.json({ error: "invalid_kind", hint: MEMORY_KINDS.join(", ") }, { status: 422 });
  const label = String(body.label || "").trim();
  const value = String(body.value || "").trim();
  if (!label || !value) return NextResponse.json({ error: "missing_fields", hint: "label + value required" }, { status: 422 });

  const entry = memoryEntry(kind as MemoryKind, label, value, Number(body.performance) || 0.5, {
    channels: Array.isArray(body.channels) ? (body.channels as CreativeChannel[]) : [],
    audiences: Array.isArray(body.audiences) ? (body.audiences as string[]) : [],
    tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
  });
  const sql = db();
  const store = sql ? new NeonCreativeMemoryStore(sql) : memFallback;
  const saved = await store.record(entry);
  return NextResponse.json({ ok: true, entry: saved });
}
