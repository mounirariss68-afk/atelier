-- POV evidence snapshot + race-safe version numbering.
--
-- fact_snapshot / fact_snapshot_at: the promoted-fact set frozen at outline
-- APPROVAL time; draft/revise consume exactly this evidence (no silent
-- drift). Nullable — legacy POVs simply have no snapshot until their outline
-- is (re-)approved.
--
-- uq_atelier_povv_num: version numbers must be unique per POV so concurrent
-- draft/revise launches cannot create duplicate versions (the writer retries
-- on 23505). The index is TOTAL (covers soft-deleted rows too), so any
-- pre-existing duplicates — live or soft-deleted — are hard-deleted first,
-- keeping the most recently created row per (pov_id, version_number).
ALTER TABLE "atelier_povs" ADD COLUMN IF NOT EXISTS "fact_snapshot" jsonb;
ALTER TABLE "atelier_povs" ADD COLUMN IF NOT EXISTS "fact_snapshot_at" timestamp;

DELETE FROM "atelier_pov_versions" v
WHERE v."id" NOT IN (
  SELECT DISTINCT ON ("pov_id", "version_number") "id"
  FROM "atelier_pov_versions"
  ORDER BY "pov_id", "version_number", ("deleted_at" IS NULL) DESC, "created_at" DESC, "id" DESC
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_povv_num"
  ON "atelier_pov_versions" ("pov_id", "version_number");
