-- ============================================================
-- Task #411 — Atelier Chat RAG: extensions + trgm GIN indexes
-- ============================================================
-- Idempotent AND fresh-DB safe. Run once on boot from the API server
-- (mirrors the existing atelier-rls.sql pattern). When the `vector`
-- extension is available the embedding tables get a real pgvector
-- column for ANN search; otherwise the jsonb shadow on the Drizzle
-- table is used.
--
-- IMPORTANT: this file executes as a single batch (one implicit
-- transaction). On a freshly created database the Drizzle tables may
-- not exist yet (boot can race `drizzle push`), so every statement
-- that touches a table is guarded with to_regclass — otherwise one
-- missing table aborts the batch and rolls back CREATE EXTENSION too,
-- leaving the whole RAG layer silently unprovisioned (Task #130).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pgvector is optional at boot; the retriever falls back to brute-
-- force cosine over the jsonb mirror when the extension is missing.
DO $$
BEGIN
  PERFORM 1 FROM pg_available_extensions WHERE name = 'vector';
  IF FOUND THEN
    CREATE EXTENSION IF NOT EXISTS vector;
  END IF;
END $$;

-- pg_trgm GIN indexes on the searchable name columns the hybrid
-- resolver hits. Each guarded on table existence + IF NOT EXISTS so
-- the script is idempotent and never aborts on a pre-push database.
DO $$
BEGIN
  IF to_regclass('atelier_accounts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_atelier_accounts_name_trgm
      ON atelier_accounts USING gin (name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_atelier_accounts_brand_trgm
      ON atelier_accounts USING gin (brand_name gin_trgm_ops);
  END IF;

  IF to_regclass('atelier_opportunities') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_atelier_opps_name_trgm
      ON atelier_opportunities USING gin (name gin_trgm_ops);
  END IF;

  IF to_regclass('atelier_engagements') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_atelier_engagements_name_trgm
      ON atelier_engagements USING gin (name gin_trgm_ops);
  END IF;

  IF to_regclass('atelier_contacts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_atelier_contacts_name_trgm
      ON atelier_contacts USING gin (full_name gin_trgm_ops);
  END IF;

  IF to_regclass('atelier_deliverables') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_atelier_deliverables_name_trgm
      ON atelier_deliverables USING gin (name gin_trgm_ops);
  END IF;
END $$;

-- ============================================================
-- Task #575 — Document-chunk embeddings: pgvector column + HNSW
-- ============================================================
-- The Drizzle table atelier_document_chunk_embeddings stores the
-- vector in `vec` (jsonb). When pgvector is present we add a real
-- `embedding vector(384)` column + HNSW index for fast ANN. The model
-- is all-MiniLM-L6-v2 (384 dims). pg_trgm GIN on the chunk text powers
-- the lexical half of hybrid retrieval.
DO $$
BEGIN
  IF to_regclass('atelier_document_chunk_embeddings') IS NULL THEN
    RETURN; -- table not pushed yet; ingest self-heals later (Task #130)
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

    -- HNSW index for cosine ANN. Built IF NOT EXISTS so boot is idempotent.
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

-- ============================================================
-- Task #871 — Two-dimensional partner stage model migration
-- ============================================================
-- Partnership stage: consideration → exploration → agreed (legacy
-- "candidate" maps to "consideration"). Agreement stage (new column,
-- pushed by Drizzle): legacy "agreed" rows meant signed/active, so
-- agreed rows with a NULL agreement_stage backfill to "signed" —
-- new write surfaces always stamp an explicit agreement stage, so a
-- NULL there only ever means a pre-migration row.
DO $$
BEGIN
  IF to_regclass('atelier_partner_firms') IS NULL THEN
    RETURN;
  END IF;
  UPDATE atelier_partner_firms
    SET partnership_stage = 'consideration'
    WHERE partnership_stage = 'candidate';
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'atelier_partner_firms'
      AND column_name = 'agreement_stage'
  ) THEN
    UPDATE atelier_partner_firms
      SET agreement_stage = 'signed'
      WHERE partnership_stage = 'agreed' AND agreement_stage IS NULL;
  END IF;
END $$;
