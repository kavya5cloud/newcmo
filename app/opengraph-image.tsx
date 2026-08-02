import { ImageResponse } from "next/og";

// The social card. Without one, every link to Populr shared on LinkedIn, X or Slack
// unfurls as a bare URL — which matters more than usual for a product whose job is
// publishing to those platforms.
//
// Generated rather than a checked-in PNG so it cannot drift from the brand, and drawn with
// system fonts so the build never depends on fetching a font file.

export const runtime = "edge";
export const alt = "Populr — your AI CMO";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#080a09",
          padding: "72px 80px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 34, color: "#fafafa", letterSpacing: "-0.02em" }}>
          Populr<span style={{ color: "#d5ff72" }}>.</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {/* Satori requires an explicit display on any element with more than one child,
              so the two lines are flex children rather than text split by a <br />. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 78,
              color: "#fafafa",
              letterSpacing: "-0.045em",
              lineHeight: 1.05,
              maxWidth: 900,
            }}
          >
            <div>Your CMO, running</div>
            <div>marketing daily.</div>
          </div>
          <div style={{ fontSize: 30, color: "#9aa39c", maxWidth: 860, lineHeight: 1.35 }}>
            SEO, AI-search visibility, Reddit and content — drafted every day. You approve what ships.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 24, color: "#6f7a72" }}>
          <div style={{ display: "flex", width: 12, height: 12, borderRadius: 12, background: "#d5ff72" }} />
          trypopulr.in
        </div>
      </div>
    ),
    size,
  );
}
