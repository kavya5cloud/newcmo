// Escaping text that goes into inline SVG/markup.
//
// The chart writes labels straight into SVG, so anything a founder typed — a brand name with
// an ampersand, a competitor called "<unknown>" — has to be escaped or it breaks the render.

export function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
