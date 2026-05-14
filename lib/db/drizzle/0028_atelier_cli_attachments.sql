-- =====================================================================
-- Task #334 — Atelier CLI attachments + extracted documents.
--
-- Adds:
--   atelier_cli_attachments       — durable per-upload metadata row
--   atelier_extracted_documents   — per-attachment normalised text + chunks
--   atelier_opportunities.qualification_rubric  — deterministic 6-dim score
--
-- Idempotent: every DDL uses IF NOT EXISTS.
-- =====================================================================

ALTER TABLE atelier_opportunities
  ADD COLUMN IF NOT EXISTS qualification_rubric jsonb;

CREATE TABLE IF NOT EXISTS atelier_cli_attachments (
  id               text PRIMARY KEY,
  org_id           text NOT NULL,
  user_id          text NOT NULL,
  session_id       text,
  turn_id          text,
  file_name        text NOT NULL,
  mime             text NOT NULL,
  size_bytes       integer NOT NULL,
  sha256           text NOT NULL,
  encrypted_ref    text NOT NULL,
  status           text NOT NULL DEFAULT 'uploaded',
  rejection_reason text,
  intent_hint      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_atelier_cli_attachments_user
  ON atelier_cli_attachments (user_id);
CREATE INDEX IF NOT EXISTS idx_atelier_cli_attachments_session
  ON atelier_cli_attachments (session_id);
CREATE INDEX IF NOT EXISTS idx_atelier_cli_attachments_turn
  ON atelier_cli_attachments (turn_id);
CREATE INDEX IF NOT EXISTS idx_atelier_cli_attachments_status
  ON atelier_cli_attachments (status);

CREATE TABLE IF NOT EXISTS atelier_extracted_documents (
  id               text PRIMARY KEY,
  org_id           text NOT NULL,
  attachment_id    text NOT NULL,
  kind             text NOT NULL,
  normalized_text  text NOT NULL DEFAULT '',
  table_summary    jsonb,
  slide_texts      jsonb,
  email_headers    jsonb,
  chunks           jsonb NOT NULL DEFAULT '[]'::jsonb,
  digest           jsonb,
  warnings         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_extracted_attachment
  ON atelier_extracted_documents (attachment_id);
CREATE INDEX IF NOT EXISTS idx_atelier_extracted_kind
  ON atelier_extracted_documents (kind);
