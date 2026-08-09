-- Task #845 — employment/salary letter issuance log (self-service letters via chat).
CREATE TABLE IF NOT EXISTS "atelier_letter_issuances" (
  "id" text PRIMARY KEY,
  "org_id" text NOT NULL DEFAULT 'aico',
  "user_id" text NOT NULL,
  "person_id" text NOT NULL,
  "letter_type" text NOT NULL,
  "language" text NOT NULL,
  "delivery_mode" text NOT NULL,
  "addressee_name" text,
  "addressee_institution" text,
  "purpose" text,
  "travel_start" text,
  "travel_end" text,
  "ref_number" text NOT NULL,
  "entity_id" text,
  "entity_name" text,
  "signatory_name" text,
  "signatory_title" text,
  "status" text NOT NULL DEFAULT 'issued',
  "email_via" text,
  "email_to" text,
  "document_id" text,
  "file_name" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_atelier_letter_issuances_org" ON "atelier_letter_issuances" ("org_id");
CREATE INDEX IF NOT EXISTS "idx_atelier_letter_issuances_person" ON "atelier_letter_issuances" ("person_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_letter_issuances_ref" ON "atelier_letter_issuances" ("org_id", "ref_number");
