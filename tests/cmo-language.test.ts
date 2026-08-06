import { describe, expect, it } from "vitest";
import { channelName } from "@/lib/cmo/planner";

// The CMO's answers were reading as broken because channel identifiers were interpolated
// straight into prose: "prioritizing seo is the way to go", "Invest in linkedin". They are
// database ids, fine in a row and wrong in a sentence — and the model copies whatever it is
// handed, so a lowercase id in the evidence became a lowercase id in the reply.

describe("channels are written the way people write them", () => {
  it("capitalises the ones with real names", () => {
    expect(channelName("seo")).toBe("SEO");
    expect(channelName("linkedin")).toBe("LinkedIn");
    expect(channelName("x")).toBe("X");
    expect(channelName("reddit")).toBe("Reddit");
    expect(channelName("hn")).toBe("Hacker News");
  });

  it("describes the ones whose id is jargon", () => {
    // "geo" and "articles" mean nothing to a founder.
    expect(channelName("geo")).toBe("AI search visibility");
    expect(channelName("articles")).toBe("your blog");
  });

  it("never renders a bare lowercase id for a known channel", () => {
    for (const id of ["seo", "linkedin", "x", "reddit", "hn", "geo", "articles"]) {
      expect(channelName(id)).not.toBe(id.toLowerCase());
    }
  });

  it("passes an unknown channel through rather than dropping it", () => {
    // A new channel should look unstyled, not vanish from the sentence.
    expect(channelName("tiktok")).toBe("tiktok");
  });
});
