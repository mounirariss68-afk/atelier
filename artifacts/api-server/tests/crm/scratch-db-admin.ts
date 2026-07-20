/**
 * Task #40 — async admin half of the CRM harness isolation bootstrap.
 *
 * Runs as a CHILD process (spawnSync from ./scratch-db.ts) so the parent
 * module can stay fully synchronous: top-level await in an ESM module does
 * NOT block sibling imports from evaluating, so @workspace/db would bind the
 * live DATABASE_URL if the bootstrap were async in-process.
 *
 * Reads:  CRM_LIVE_URL (server to create the scratch DB on)
 *         CRM_SCRATCH_URL (the scratch DB itself)
 *         CRM_SCRATCH_DB_NAME
 * Does:   CREATE DATABASE if missing, then applies lib/db/src/atelier-rls.sql
 *         to the scratch DB (idempotent). Exits non-zero on any failure.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";

const liveUrl = process.env.CRM_LIVE_URL;
const scratchUrl = process.env.CRM_SCRATCH_URL;
const dbName = process.env.CRM_SCRATCH_DB_NAME;
const phase = process.argv[2]; // "create" | "rls"

if (!scratchUrl || !phase || (phase === "create" && (!liveUrl || !dbName))) {
  console.error("scratch-db-admin: missing CRM_* env or phase argument");
  process.exit(1);
}

if (phase === "create") {
  const admin = new pg.Client({ connectionString: liveUrl });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${dbName!.replace(/"/g, '""')}"`);
      console.log(`[crm-harness] Created scratch database "${dbName}".`);
    } else {
      console.log(`[crm-harness] Reusing scratch database "${dbName}".`);
    }
  } finally {
    await admin.end().catch(() => {});
  }
  // pgvector must exist BEFORE the drizzle push or the push aborts on the
  // vector-typed embedding columns (fresh/stale scratch DBs).
  const scratch = new pg.Client({ connectionString: scratchUrl });
  await scratch.connect();
  try {
    await scratch.query("CREATE EXTENSION IF NOT EXISTS vector");
  } finally {
    await scratch.end().catch(() => {});
  }
} else if (phase === "rls") {
  const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
  const rlsSql = readFileSync(
    join(repoRoot, "lib", "db", "src", "atelier-rls.sql"),
    "utf8",
  );
  const scratch = new pg.Client({ connectionString: scratchUrl });
  await scratch.connect();
  try {
    await scratch.query(rlsSql);
    console.log("[crm-harness] Applied atelier-rls.sql to the scratch database.");
  } finally {
    await scratch.end().catch(() => {});
  }
} else {
  console.error(`scratch-db-admin: unknown phase "${phase}"`);
  process.exit(1);
}
