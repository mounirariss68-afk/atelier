-- ============================================================
-- Task #411 — Atelier Chat RAG: extensions + trgm GIN indexes
-- ============================================================
-- Idempotent. Run once on boot from the API server (mirrors the
-- existing atelier-rls.sql pattern). When the `vector` extension is
-- available the embedding tables get a real pgvector column for ANN
-- search; otherwise the jsonb shadow on the Drizzle table is used.

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
-- resolver hits. Each `IF NOT EXISTS` so the script is idempotent.
CREATE INDEX IF NOT EXISTS idx_atelier_accounts_name_trgm
  ON atelier_accounts USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_atelier_accounts_brand_trgm
  ON atelier_accounts USING gin (brand_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_atelier_opps_name_trgm
  ON atelier_opportunities USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_atelier_engagements_name_trgm
  ON atelier_engagements USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_atelier_contacts_name_trgm
  ON atelier_contacts USING gin (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_atelier_deliverables_name_trgm
  ON atelier_deliverables USING gin (name gin_trgm_ops);
