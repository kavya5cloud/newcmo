import { describe, expect, it } from "vitest";
import {
  CONTENT_ENGINE_PATHS,
  SHOW_CONTENT_ENGINE,
  isContentEngineApi,
  isContentEnginePath,
} from "@/lib/flags";

// The flag is read from the environment at module load, so these run against the default:
// content engine off. That is the state that ships, and the state worth pinning down.

describe("content engine flag", () => {
  it("is off unless the environment turns it on", () => {
    expect(SHOW_CONTENT_ENGINE).toBe(false);
  });
});

describe("isContentEnginePath", () => {
  it("blocks every authoring route", () => {
    for (const p of CONTENT_ENGINE_PATHS) expect(isContentEnginePath(p)).toBe(true);
  });

  it("blocks /studio itself, which is the composer", () => {
    expect(isContentEnginePath("/studio")).toBe(true);
    expect(isContentEnginePath("/studio/")).toBe(true);
  });

  // The whole reason the block list is a list and not a prefix match. The Launch Workspace
  // is the only primary call to action left on the landing page; taking it down with the
  // content engine would leave the site pointing at a redirect.
  it("leaves the Launch Workspace reachable", () => {
    expect(isContentEnginePath("/studio/launch")).toBe(false);
  });

  it("leaves reporting and publishing views reachable", () => {
    for (const p of ["/studio/market", "/studio/learning", "/studio/jobs", "/studio/integrations", "/studio/social", "/studio/publishing"]) {
      expect(isContentEnginePath(p)).toBe(false);
    }
  });

  it("does not block unrelated routes", () => {
    for (const p of ["/", "/app", "/app/campaigns", "/early-access", "/studiolibrary"]) {
      expect(isContentEnginePath(p)).toBe(false);
    }
  });

  it("matches exactly, so a deeper path under a blocked route is not caught by accident", () => {
    // Nothing renders here today; asserting it keeps the matcher honest if that changes.
    expect(isContentEnginePath("/studio/documents/draft-1")).toBe(false);
  });
});

describe("isContentEngineApi", () => {
  it("blocks the generation endpoints", () => {
    for (const p of ["/api/content/compose", "/api/content/refine", "/api/content/generate", "/api/content/edit", "/api/ugc"]) {
      expect(isContentEngineApi(p)).toBe(true);
    }
  });

  it("blocks their subpaths", () => {
    expect(isContentEngineApi("/api/ugc/anything")).toBe(true);
  });

  it("leaves other content APIs alone", () => {
    // history is a read of what already exists — sealing it would break the library view
    // for content generated before the engine was switched off.
    expect(isContentEngineApi("/api/content/history")).toBe(false);
    expect(isContentEngineApi("/api/state")).toBe(false);
    expect(isContentEngineApi("/api/social/dashboard")).toBe(false);
  });

  it("does not match a route that merely starts with the same characters", () => {
    expect(isContentEngineApi("/api/ugcx")).toBe(false);
  });
});
