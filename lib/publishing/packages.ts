import type { LaunchPlan } from "@/lib/launch/types";
import { platformFor } from "./providers";
import type { ContentPackage, PackageAsset } from "./types";

// Content Packages (Part 9) — a ContentPackage groups the related assets a launch
// produces (hero video, landing hero, LinkedIn, email, press release, deck, carousel,
// ads…). Every Launch Engine output becomes one package, and the package carries the
// Asset Graph lineage (derivation edges) so provenance is never lost.

/** Build a ContentPackage from a Launch Engine plan. Deterministic. */
export function packageFromLaunchPlan(plan: LaunchPlan, now = 0): ContentPackage {
  // Stage lookup from the publishing schedule (assetKey → stage).
  const stageByKey = new Map(plan.publishingSchedule.map((s) => [s.assetKey, s.stage]));

  const assets: PackageAsset[] = plan.campaigns.flatMap((c) =>
    c.assetPlan.assets.map((a) => {
      const assetKey = `${c.id}:${a.kind}`;
      return {
        assetKey,
        kind: a.kind,
        label: a.label,
        channel: a.channel,
        platform: platformFor(a.kind, a.channel),
        campaignId: c.id,
        dependsOn: a.dependsOn.map((d) => `${c.id}:${d}`),
        stage: stageByKey.get(assetKey) ?? "draft",
      };
    })
  );

  // Lineage edges come from the launch dependency graph (cross-asset derivation).
  const lineage = plan.dependencies.edges.map((e) => ({ from: e.from, to: e.to }));

  return {
    id: `pkg_${plan.launchId}`,
    launchId: plan.launchId,
    mission: plan.mission,
    title: `${plan.mission} — launch package`,
    assets,
    lineage,
    createdAt: now,
  };
}

/** Assets in a package that a given asset depends on (upstream), by key. */
export function packageUpstream(pkg: ContentPackage, assetKey: string): string[] {
  return pkg.assets.find((a) => a.assetKey === assetKey)?.dependsOn ?? [];
}

/** Assets in a package derived from the given asset (downstream), by key. */
export function packageDownstream(pkg: ContentPackage, assetKey: string): string[] {
  return pkg.lineage.filter((e) => e.from === assetKey).map((e) => e.to);
}
