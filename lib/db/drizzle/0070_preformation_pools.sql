-- Task #1092 — pre-formation entity cost pools: ownership/settlement record
-- on legal entities, and per-pool stamping on GL journal lines (clearing
-- account quarantine + settlement attribution). Idempotent: safe to run
-- against databases that already received the columns via drizzle push.

ALTER TABLE "atelier_legal_entities" ADD COLUMN IF NOT EXISTS "formation" jsonb;
ALTER TABLE "atelier_gl_journal_line" ADD COLUMN IF NOT EXISTS "pre_formation_entity_id" text;
