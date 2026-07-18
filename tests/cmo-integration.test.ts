import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { assembleCmoContext } from "@/lib/services/cmo-context";
import { projectBusinessGraph } from "@/lib/business-graph";
import { decide } from "@/lib/cmo/pipeline";
import { persistGraph, persistDecision, appendDecisionEvent, writeCachedCmoResponse, readCachedCmoResponse, fingerprint } from "@/lib/cmo/store";
import { logRecommendations } from "@/lib/intel";
import type { CmoResponse } from "@/lib/cmo/contracts";

// Full-pipeline integration test against the real database: retrieval → graph → decision →
// persistence → cache. Self-skips when DATABASE_URL isn't available.
const sql = db();
const WS = "test:integration:" + Date.now();

describe.skipIf(!sql)("CMO pipeline integration", () => {
  beforeAll(async () => {
    // Seed a canonical business profile (logRecommendations writes business_profiles).
    await logRecommendations(
      sql!, WS, "https://acme.test",
      { name: "AcmeCanonical", oneLiner: "widgets that ship", audience: "makers", voice: "bold" },
      [{ channel: "seo", title: "Seed recommendation for the test workspace" }],
      { provider: null, model: null, snapshotVersion: null }
    );
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM decision_events WHERE decision_artifact_id IN (SELECT id FROM decision_artifacts WHERE workspace_key = ${WS})`;
    await sql`DELETE FROM decision_artifacts WHERE workspace_key = ${WS}`;
    await sql`DELETE FROM cmo_response_cache WHERE workspace_key = ${WS}`;
    await sql`DELETE FROM business_graph_snapshots WHERE workspace_key = ${WS}`;
    await sql`DELETE FROM recommendation_events WHERE recommendation_id IN (SELECT id FROM recommendations WHERE workspace_key = ${WS})`;
    await sql`DELETE FROM recommendations WHERE workspace_key = ${WS}`;
    await sql`DELETE FROM business_profiles WHERE workspace_key = ${WS}`;
  });

  it("retrieval uses the canonical profile, ignoring a spoofed client profile", async () => {
    const ctx = await assembleCmoContext(sql!, WS, { name: "SPOOFED", oneLiner: "malware" }, "https://acme.test");
    expect(ctx.business.name).toBe("AcmeCanonical");
    expect(ctx.business.oneLiner).toBe("widgets that ship");
  });

  it("projects a deterministic graph version and persists a snapshot", async () => {
    const ctx = await assembleCmoContext(sql!, WS, {}, "https://acme.test");
    const g1 = await projectBusinessGraph(sql!, WS, ctx.business, "https://acme.test", ctx);
    const g2 = await projectBusinessGraph(sql!, WS, ctx.business, "https://acme.test", ctx);
    expect(g1.version).toBe(g2.version); // same state → same version
    await persistGraph(sql!, g1);
    const snap = (await sql!`SELECT version FROM business_graph_snapshots WHERE workspace_key = ${WS}`) as { version: string }[];
    expect(snap[0]?.version).toBe(g1.version);
  });

  it("persists a decision artifact with an append-only event trail", async () => {
    const ctx = await assembleCmoContext(sql!, WS, {}, "https://acme.test");
    const graph = await projectBusinessGraph(sql!, WS, ctx.business, "https://acme.test", ctx);
    const decision = decide(ctx, graph.evidence);
    const id = await persistDecision(sql!, WS, graph.version, "strategy", "what should we do next?", decision, Object.values(graph.evidence).flat());
    await appendDecisionEvent(sql!, id, "rendered", { model: "test-model", textLength: 42 });
    const events = (await sql!`SELECT event, payload->>'model' AS model FROM decision_events WHERE decision_artifact_id = ${id} ORDER BY created_at`) as { event: string; model: string | null }[];
    expect(events.map((e) => e.event)).toEqual(["created", "rendered"]);
    expect(events[1].model).toBe("test-model");
    // artifact carries the graph version (provenance)
    const art = (await sql!`SELECT graph_version FROM decision_artifacts WHERE id = ${id}`) as { graph_version: string }[];
    expect(art[0].graph_version).toBe(graph.version);
  });

  it("round-trips the graph-versioned response cache", async () => {
    const response = { text: "cached body", intent: "strategy", confidence: "cold", decision: {} as never, evidence: [], cached: false } as CmoResponse;
    const key = fingerprint(`${WS}:cache-test`);
    await writeCachedCmoResponse(sql!, key, WS, "gv-1", response);
    const got = await readCachedCmoResponse(sql!, key);
    expect(got?.text).toBe("cached body");
    expect(got?.intent).toBe("strategy");
  });
});
