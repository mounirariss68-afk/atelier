/**
 * Task #411 — Apply Atelier Chat RAG SQL on API boot.
 *
 * The RAG layer needs the `pg_trgm` extension (always) and `pgvector`
 * (when available) plus a handful of GIN indexes on entity name
 * columns. The Drizzle migration story for these doesn't carry
 * `CREATE EXTENSION` so we ship a single idempotent SQL file
 * (`lib/db/src/atelier-cli-rag.sql`) and run it once at boot.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

let applied = false;

export async function applyAtelierCliRagSql(): Promise<void> {
  if (applied) return;
  // Resolve relative to this module — works in ts-node, the bundled
  // build, and tests, since the SQL ships inside `lib/db/src`.
  const here = dirname(fileURLToPath(import.meta.url));
  // The api-server can be invoked either as TS source (here =
  // .../artifacts/api-server/src/lib/atelier-cli) or as a bundled
  // dist build (here = .../artifacts/api-server/dist). Try walking
  // up 1..6 levels and then look for `lib/db/src/atelier-cli-rag.sql`,
  // which deterministically locates the file from any of those.
  const SQL_REL = join("lib", "db", "src", "atelier-cli-rag.sql");
  const candidates: string[] = [];
  let cursor = here;
  for (let i = 0; i < 8; i++) {
    candidates.push(join(cursor, SQL_REL));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  // Also honour an explicit override for unusual deploy layouts.
  if (process.env.ATELIER_REPO_ROOT) {
    candidates.unshift(join(process.env.ATELIER_REPO_ROOT, SQL_REL));
  }
  let text: string | null = null;
  for (const p of candidates) {
    try {
      text = await readFile(p, "utf8");
      break;
    } catch {
      // try next
    }
  }
  if (!text) {
    throw new Error(`atelier-cli-rag.sql not found; looked in: ${candidates.join(", ")}`);
  }
  // Each statement is idempotent; execute as one batch via raw sql.
  await db.execute(sql.raw(text));
  applied = true;
}
