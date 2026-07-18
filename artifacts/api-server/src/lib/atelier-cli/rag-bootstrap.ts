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

/**
 * Task #130 — Ensure the pgvector `embedding` column (+ HNSW index) on
 * atelier_document_chunk_embeddings exists. Boot can run the RAG SQL
 * before `drizzle push` has created the table on a fresh database, in
 * which case the column DDL is skipped; ingest calls this to self-heal
 * instead of failing. Returns true when the column exists afterwards
 * (pgvector installed), false when pgvector is unavailable (jsonb
 * brute-force fallback stays in effect).
 */
export async function ensureDocEmbeddingColumn(): Promise<boolean> {
  await db.execute(
    sql.raw(`
      DO $$
      BEGIN
        IF to_regclass('atelier_document_chunk_embeddings') IS NULL THEN
          RETURN;
        END IF;
        PERFORM 1 FROM pg_available_extensions WHERE name = 'vector';
        IF FOUND THEN
          CREATE EXTENSION IF NOT EXISTS vector;
        END IF;
        PERFORM 1 FROM pg_extension WHERE extname = 'vector';
        IF FOUND THEN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'atelier_document_chunk_embeddings'
              AND column_name = 'embedding'
          ) THEN
            ALTER TABLE atelier_document_chunk_embeddings
              ADD COLUMN embedding vector(384);
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM pg_class WHERE relname = 'idx_atelier_chunk_emb_hnsw'
          ) THEN
            CREATE INDEX idx_atelier_chunk_emb_hnsw
              ON atelier_document_chunk_embeddings
              USING hnsw (embedding vector_cosine_ops);
          END IF;
        END IF;
        -- Lexical half of hybrid retrieval over chunk text.
        CREATE INDEX IF NOT EXISTS idx_atelier_chunk_emb_text_trgm
          ON atelier_document_chunk_embeddings USING gin (text gin_trgm_ops);
      END $$;
    `),
  );
  const res = await db.execute<{ present: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'atelier_document_chunk_embeddings'
        AND column_name = 'embedding'
    ) AS present
  `);
  return Boolean(res.rows[0]?.present);
}
