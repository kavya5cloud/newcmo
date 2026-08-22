import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Three mobile faults reported from a phone, each of which typechecks and builds cleanly and
// can only be caught by looking at what the rules actually say. Asserted against the source
// because there is no DOM here — crude, and it still fails if someone removes the fix.

const css = readFileSync("app/globals.css", "utf8");
const skeleton = readFileSync("app/app/_components/DashboardSkeleton.tsx", "utf8");
const page = readFileSync("app/app/page.tsx", "utf8");

describe("the loading screen is not a black void on a phone", () => {
  it("marks one skeleton column active, since mobile hides the rest", () => {
    // .appui .col{display:none} on mobile, .col.mactive is the only one shown. The skeleton
    // copied the column markup without the class, so all four were hidden.
    expect(css).toMatch(/\.appui \.col\{display:none/);
    expect(css).toMatch(/\.appui \.col\.mactive\{display:flex/);
    expect(skeleton).toContain('mobile ? " mactive" : ""');
    expect(skeleton).toContain('<Column title="Company" mobile>');
  });
});

describe("sideways rails do not draw a scrollbar across the screen", () => {
  it("hides the track on both scrolling navs", () => {
    for (const rail of [".settings .set-rail::-webkit-scrollbar", ".st-nav::-webkit-scrollbar"]) {
      expect(css, rail).toContain(rail);
    }
    // Hiding it alone would remove the only hint that there is more; the fade replaces it.
    expect(css).toMatch(/\.settings \.set-rail \{[\s\S]*?mask-image/);
  });
});

describe("a returning visitor is not shown the new-visitor screen first", () => {
  it("decides the branch from local state before awaiting the network", () => {
    // loadState() fetches /api/state; awaiting it meant every mount rendered the onboarding
    // screen until the network answered. loadLocal() is synchronous and holds the same thing.
    expect(page).toContain("const local = loadLocal();");
    expect(page).toContain("setHydrating(false);");
    // And nothing is rendered until that is known.
    expect(page).toMatch(/if \(hydrating\) return/);
  });

  it("still reconciles with the cloud copy afterwards", () => {
    expect(page).toContain("const { saved, cloud } = await loadState();");
  });
});
