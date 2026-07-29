-- Session lineage for the chat verbatim replay window: an inactivity
-- rollover mints a fresh session pointing at its soft-deleted predecessor
-- so the replay window can seed from the predecessor's tail.
ALTER TABLE "atelier_cli_sessions"
  ADD COLUMN IF NOT EXISTS "predecessor_session_id" text;
