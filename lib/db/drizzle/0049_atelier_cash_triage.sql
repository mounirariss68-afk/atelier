-- ----------------------------------------------------------------
-- Task #431 — cash triage & GL linkage columns on bank transactions.
--
-- matched_state gains two values: parked | journaled
--   (full set: unmatched | proposed | matched | parked | journaled)
--
-- New columns:
--   legal_entity_id      — entity tag for GL posting (backfilled from
--                          the bank account when null; introduced with
--                          Task #428 schema but never migrated here)
--   match_proposal       — persisted matcher proposal (inflow invoice
--                          candidates or outflow source candidates)
--   matched_ref_kind     — invoice_application | contractor_payment |
--                          partner_firm_invoice | expense |
--                          manual_journal | other
--   matched_ref_id       — id of the matched source row
--   parked_reason        — free-text reason when triage parks a row
--   parked_by_user_id    — who parked it
--   gl_journal_entry_id  — manual-journal linkage for journaled rows
-- ----------------------------------------------------------------

ALTER TABLE atelier_bank_transaction ADD COLUMN IF NOT EXISTS legal_entity_id     TEXT;
ALTER TABLE atelier_bank_transaction ADD COLUMN IF NOT EXISTS match_proposal      JSONB;
ALTER TABLE atelier_bank_transaction ADD COLUMN IF NOT EXISTS matched_ref_kind    TEXT;
ALTER TABLE atelier_bank_transaction ADD COLUMN IF NOT EXISTS matched_ref_id      TEXT;
ALTER TABLE atelier_bank_transaction ADD COLUMN IF NOT EXISTS parked_reason       TEXT;
ALTER TABLE atelier_bank_transaction ADD COLUMN IF NOT EXISTS parked_by_user_id   TEXT;
ALTER TABLE atelier_bank_transaction ADD COLUMN IF NOT EXISTS gl_journal_entry_id TEXT;

-- Backfill entity tags from the owning bank account for existing rows.
UPDATE atelier_bank_transaction t
SET legal_entity_id = a.legal_entity_id
FROM atelier_bank_account a
WHERE t.bank_account_id = a.id
  AND t.legal_entity_id IS NULL
  AND a.legal_entity_id IS NOT NULL;

-- Triage lookups by matched source.
CREATE INDEX IF NOT EXISTS idx_atelier_bank_txn_matched_ref
  ON atelier_bank_transaction (matched_ref_kind, matched_ref_id);
