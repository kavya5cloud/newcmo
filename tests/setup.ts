import { readFileSync } from "node:fs";

// Unit tests must not accidentally depend on a developer's local database. Opt in to
// the DB-backed integration suite with RUN_DB_INTEGRATION_TESTS=true; CI can still
// provide DATABASE_URL directly when it has a reachable test database.
if (process.env.RUN_DB_INTEGRATION_TESTS === "true") {
  try {
    const env = readFileSync(".env.local", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env.local — DB-backed integration tests self-skip */
  }
}
