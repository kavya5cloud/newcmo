import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimit, requestKey } from "@/lib/throttle";
import { workspaceKey } from "@/lib/intel";
import { buildCharacter, NeonCharacterStore, InMemoryCharacterStore } from "@/lib/creative-intelligence";
import type { Persona } from "@/lib/creative-intelligence";

export const runtime = "nodejs";

const memFallback = new InMemoryCharacterStore();

// Character Engine API — reusable AI presenters / UGC personas (Asset Graph linked).
export async function GET(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 40 : 15, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  const key = await workspaceKey(req.nextUrl.searchParams.get("wsid"));
  const sql = db();
  const store = sql ? new NeonCharacterStore(sql) : memFallback;
  const characters = await store.list(key ?? undefined);
  return NextResponse.json({ ok: true, characters });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  const limit = rateLimit(requestKey(req.headers, session?.userId), session ? 20 : 8, 60_000);
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfter) } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400 }); }
  const name = String(body.name || "").trim();
  const persona = body.persona as Persona | undefined;
  if (!name || !persona || !persona.audience) return NextResponse.json({ error: "missing_fields", hint: "name + persona.audience required" }, { status: 422 });

  const key = await workspaceKey((body.wsid as string) ?? null);
  const character = buildCharacter({
    name,
    persona: { name: persona.name || name, audience: persona.audience, motivations: persona.motivations || [], objections: persona.objections || [] },
    brandVoice: String(body.brandVoice || "confident, clear"),
    appearance: body.appearance as string | undefined,
    style: body.style as string | undefined,
    workspaceKey: key ?? undefined,
  });

  const sql = db();
  const store = sql ? new NeonCharacterStore(sql) : memFallback;
  await store.create(character);
  return NextResponse.json({ ok: true, character });
}
