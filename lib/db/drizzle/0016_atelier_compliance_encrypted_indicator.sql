-- Task #255 follow-up: encrypted-at-rest indicator on compliance records.
ALTER TABLE atelier_compliance_records
  ADD COLUMN IF NOT EXISTS encrypted_at_rest boolean NOT NULL DEFAULT true;
