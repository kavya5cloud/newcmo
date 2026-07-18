import { readFileSync } from "node:fs";

// Load .env.local into process.env for integration tests that hit the real DB.
// If it's absent (e.g. CI without secrets), those tests self-skip.
try {
  const env = readFileSync(".env.local", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env.local — DB-backed integration tests self-skip */
}
