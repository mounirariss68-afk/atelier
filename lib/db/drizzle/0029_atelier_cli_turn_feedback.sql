-- =====================================================================
-- Task #335 — Per-turn feedback + recording-trace columns on cli_turns.
--
-- `feedback`         — { thumb: 'up'|'down', category?, freeText?, recordedAt }
-- `recording_trace`  — opaque jsonb captured for "founding-partner replay"
--                      mode (only populated when ATELIER_CLI_RECORDING_ENABLED).
--
-- Both are nullable + jsonb so the orchestrator can write them without
-- schema-level coupling. Idempotent migration.
-- =====================================================================

ALTER TABLE atelier_cli_turns
  ADD COLUMN IF NOT EXISTS feedback         jsonb,
  ADD COLUMN IF NOT EXISTS recording_trace  jsonb;

CREATE INDEX IF NOT EXISTS idx_atelier_cli_turns_feedback_thumb
  ON atelier_cli_turns ((feedback->>'thumb'))
  WHERE feedback IS NOT NULL;
