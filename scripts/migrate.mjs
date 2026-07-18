import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

// Idempotent migration runner. Applies every db/migrations/*.sql in filename order.
// Neon's HTTP driver executes one statement per call, so we split on the statement
// terminator. All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so re-running
// is safe. Run with:  npm run db:migrate   (requires DATABASE_URL).

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = neon(url);

const dir = join(process.cwd(), "db/migrations");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
if (!files.length) {
  console.log("No migrations found.");
  process.exit(0);
}

let total = 0;
for (const file of files) {
  const raw = await readFile(join(dir, file), "utf8");
  // Drop line comments, then split on the statement terminator. These migrations contain
  // no semicolons inside statements (no functions/DO blocks), so a bare split is safe.
  const statements = raw
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await sql.query(stmt);
    total++;
  }
  console.log(`Applied ${file} (${statements.length} statements)`);
}
console.log(`Done — ${files.length} file(s), ${total} statements.`);
