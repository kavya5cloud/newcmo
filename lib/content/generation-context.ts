import { db } from "@/lib/db";
import { learningEngine } from "@/lib/learning/shared";
import { marketPlatform } from "@/lib/market/shared";
import { socialEngine } from "@/lib/social/shared";
import { createAdapterRegistry } from "@/lib/social/registry";
import type { SocialPlatform } from "@/lib/social/types";

// The context every generation consumes.
//
// Assembled once per request from the engines that already own each piece — Business Graph
// and Market Memory via the market platform, patterns and Brand DNA via the Learning
// Engine, connected accounts and platform limits via the Publishing adapters. No generator
// fetches its own, so two variants of the same idea can never be written against different
// facts.
//
// Every source degrades independently. A dead market feed costs the market section, not the
// generation — and the prompt says which sections are missing so the model doesn't fill the
// gap with invention.

export type GenerationContext = {
  tenant: string;
  brand: { name: string; voice: string[] };
  audience: string;
  market: {
    headline: string;
    trends: string[];
    competitors: string[];
    opportunities: string[];
    keywords: string[];
  };
  /** Recall from Market Memory — what this workspace has observed before. */
  memory: string[];
  /** What the Learning Engine has established works. */
  learned: { patterns: string[]; insights: string[] };
  platforms: { platform: SocialPlatform; maxText: number; maxAssets: number; requiresAsset: boolean; allowsVideo: boolean }[];
  previousCampaigns: string[];
  /** Sections that failed to load, named so the prompt can say so out loud. */
  missing: string[];
};

export type ContextInput = {
  tenant: string;
  audience: string;
  /** Terms to research — usually the prompt or the product. */
  terms: string[];
  /** Restrict to these platforms; defaults to whatever is connected. */
  platforms?: SocialPlatform[];
};

export async function assembleGenerationContext(input: ContextInput): Promise<GenerationContext> {
  const missing: string[] = [];
  const sql = db();

  const [accounts, brief, memory, brand, patterns] = await Promise.all([
    socialEngine().listAccounts(input.tenant).catch(() => { missing.push("connected platforms"); return []; }),
    marketPlatform().research.run({
      tenant: input.tenant, terms: input.terms.filter(Boolean).slice(0, 3),
      competitors: [], industry: "saas", audience: input.audience,
    }).catch(() => { missing.push("market intelligence"); return null; }),
    marketPlatform().memory.list(input.tenant, undefined, 12).catch(() => { missing.push("market memory"); return []; }),
    learningEngine(sql).brand.latest(input.tenant).catch(() => { missing.push("brand DNA"); return null; }),
    learningEngine(sql).patterns.all().catch(() => { missing.push("pattern library"); return []; }),
  ]);

  const connected = [...new Set(accounts.filter((a) => a.status === "connected").map((a) => a.platform))];
  const wanted = input.platforms?.length ? input.platforms : connected;
  const registry = createAdapterRegistry();

  // Platform limits come from the adapters, so a platform changing its rules changes the
  // brief the model writes against without a code edit.
  const platforms = [...new Set(wanted)].flatMap((p) => {
    const k = registry.get(p)?.constraints();
    return k ? [{ platform: p, maxText: k.maxText, maxAssets: k.maxAssets, requiresAsset: k.requiresAsset, allowsVideo: k.allowsVideo }] : [];
  });

  const voice = brand
    ? Object.entries(brand.traits).filter(([, v]) => v.evidence > 0)
      .sort((a, b) => b[1].confidence - a[1].confidence).slice(0, 4)
      .map(([trait, v]) => `${trait}: ${v.value}`)
    : [];

  return {
    tenant: input.tenant,
    brand: { name: input.terms[0] ?? "the product", voice },
    audience: input.audience,
    market: {
      headline: brief?.headline ?? "",
      trends: (brief?.trends ?? []).slice(0, 5).map((t) => `${t.topic} (${Math.round(t.confidence * 100)}% confidence)`),
      competitors: (brief?.competitors ?? []).slice(0, 4).map((c) => `${c.name}: ${c.summary}`),
      opportunities: (brief?.opportunities ?? []).slice(0, 5).map((o) => `${o.title} → ${o.recommendedAction}`),
      keywords: (brief?.keywords ?? []).slice(0, 6).map((k) => k.keyword),
    },
    memory: memory.slice(0, 8).map((m) => `${m.kind}/${m.key}: ${m.value}`),
    learned: {
      patterns: [...patterns].sort((a, b) => b.performance - a.performance).slice(0, 5)
        .map((p) => `${p.label}: ${p.value} performs ${Math.round(p.performance * 100)}%`),
      insights: [],
    },
    platforms,
    previousCampaigns: [],
    missing,
  };
}

/**
 * Render the context as prompt text. Missing sections are named rather than omitted — a
 * model told "no market data was available" writes differently from one that simply never
 * saw the heading, and the difference is whether it invents competitors.
 */
export function contextToPrompt(ctx: GenerationContext): string {
  const lines: string[] = [];
  lines.push(`AUDIENCE: ${ctx.audience}`);
  if (ctx.brand.voice.length) lines.push(`BRAND VOICE (learned from what performed): ${ctx.brand.voice.join("; ")}`);
  if (ctx.market.headline) lines.push(`MARKET HEADLINE: ${ctx.market.headline}`);
  if (ctx.market.trends.length) lines.push(`TRENDS: ${ctx.market.trends.join("; ")}`);
  if (ctx.market.competitors.length) lines.push(`COMPETITORS: ${ctx.market.competitors.join("; ")}`);
  if (ctx.market.opportunities.length) lines.push(`OPPORTUNITIES: ${ctx.market.opportunities.join("; ")}`);
  if (ctx.market.keywords.length) lines.push(`KEYWORDS WORTH RANKING FOR: ${ctx.market.keywords.join(", ")}`);
  if (ctx.memory.length) lines.push(`PREVIOUSLY OBSERVED (market memory): ${ctx.memory.join("; ")}`);
  if (ctx.learned.patterns.length) lines.push(`WHAT HAS PERFORMED BEFORE: ${ctx.learned.patterns.join("; ")}`);
  if (ctx.previousCampaigns.length) lines.push(`PREVIOUS CAMPAIGNS: ${ctx.previousCampaigns.join("; ")}`);
  if (ctx.platforms.length) {
    lines.push(`CONNECTED PLATFORMS AND THEIR HARD LIMITS:\n${ctx.platforms
      .map((p) => `- ${p.platform}: max ${p.maxText} characters, max ${p.maxAssets} assets${p.requiresAsset ? ", MEDIA REQUIRED" : ""}${p.allowsVideo ? "" : ", no video"}`)
      .join("\n")}`);
  } else {
    lines.push("CONNECTED PLATFORMS: none yet.");
  }
  if (ctx.missing.length) {
    lines.push(`UNAVAILABLE THIS RUN: ${ctx.missing.join(", ")}. Do not invent facts to fill these gaps — write from what is given and stay general where evidence is absent.`);
  }
  return lines.join("\n");
}
