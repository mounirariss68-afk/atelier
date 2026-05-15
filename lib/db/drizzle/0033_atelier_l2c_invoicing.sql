-- Task #362 — L2C Wave 3: Invoicing, e-invoicing, AR aging, Collections.
--
-- Wave 1 (#360 contracts) and Wave 2 (#361 revenue milestones / WIP) are NOT
-- merged in this environment, so this migration intentionally avoids any FKs
-- to atelier_contract / atelier_revenue_milestone / atelier_unbilled_wip_snapshot.
-- bill_to is a free-text JSONB blob; line composition draws from
-- atelier_timesheet_entries + atelier_expenses only.

-- ----------------------------------------------------------------
-- Per-jurisdiction monotonic invoice number sequence (gap-free).
-- Numbers are minted via SELECT … FOR UPDATE inside a tx in the route.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_invoice_sequence (
  jurisdiction TEXT NOT NULL,
  org_id       TEXT NOT NULL DEFAULT 'aico',
  prefix       TEXT NOT NULL,
  last_seq     INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, jurisdiction)
);

INSERT INTO atelier_invoice_sequence (org_id, jurisdiction, prefix, last_seq) VALUES
  ('aico', 'AE', 'AE-INV', 0),
  ('aico', 'SA', 'SA-INV', 0),
  ('aico', 'EU', 'EU-INV', 0),
  ('aico', 'GLOBAL', 'INV',  0)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------
-- Invoice header.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_invoice (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL DEFAULT 'aico',
  engagement_id     TEXT,                    -- nullable while drafting
  account_id        TEXT,                    -- nullable while drafting
  jurisdiction      TEXT NOT NULL,           -- AE | SA | EU | GLOBAL
  invoice_number    TEXT,                    -- assigned at issue
  currency          TEXT NOT NULL DEFAULT 'USD',
  status            TEXT NOT NULL DEFAULT 'draft',  -- draft | issued | paid | void
  -- Free-text bill-to fallback (Wave 1 not shipped). Shape:
  --  { name, address, vatId?, country?, contactEmail? }
  bill_to           JSONB NOT NULL DEFAULT '{}'::jsonb,
  subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_rate_pct      NUMERIC(6,3)  NOT NULL DEFAULT 0,
  total             NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_paid       NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes             TEXT,
  due_date          DATE,
  issued_at         TIMESTAMP,
  paid_at           TIMESTAMP,
  voided_at         TIMESTAMP,
  voided_reason     TEXT,
  pdf_ref           TEXT,                   -- enc:wallet:<key> stub
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_user_id TEXT,
  deleted_at        TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_atelier_invoice_eng    ON atelier_invoice (engagement_id);
CREATE INDEX IF NOT EXISTS idx_atelier_invoice_acct   ON atelier_invoice (account_id);
CREATE INDEX IF NOT EXISTS idx_atelier_invoice_status ON atelier_invoice (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_atelier_invoice_number
  ON atelier_invoice (org_id, jurisdiction, invoice_number)
  WHERE invoice_number IS NOT NULL AND deleted_at IS NULL;

-- ----------------------------------------------------------------
-- Invoice lines.
-- source_kind: time | expense | fee | adjustment
-- source_ref:  timesheet_entry_id | expense_id | NULL
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_invoice_line (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL DEFAULT 'aico',
  invoice_id    TEXT NOT NULL,
  ord           INTEGER NOT NULL DEFAULT 0,
  description   TEXT NOT NULL,
  qty           NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_kind   TEXT NOT NULL,
  source_ref    TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_atelier_invoice_line_invoice ON atelier_invoice_line (invoice_id);

-- ----------------------------------------------------------------
-- E-invoice submission state per channel.
-- channel: zatca | fta | peppol
-- status:  pending | submitted | cleared | rejected
-- payload + response refs use the enc:wallet:<key> indicator pattern.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_einvoice_submission (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL DEFAULT 'aico',
  invoice_id            TEXT NOT NULL,
  channel               TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  submission_payload_ref TEXT,
  response_payload_ref  TEXT,
  clearance_uuid        TEXT,
  qr_code_payload       TEXT,
  submitted_at          TIMESTAMP,
  cleared_at            TIMESTAMP,
  rejected_at           TIMESTAMP,
  rejected_reason       TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_atelier_einvoice_invoice ON atelier_einvoice_submission (invoice_id);
CREATE INDEX IF NOT EXISTS idx_atelier_einvoice_status  ON atelier_einvoice_submission (status);

-- ----------------------------------------------------------------
-- Dunning ladder template (per jurisdiction).
-- steps: [{ offsetDays, channel, template, requireApproval }]
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_dunning_ladder (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL DEFAULT 'aico',
  name          TEXT NOT NULL,
  jurisdiction  TEXT NOT NULL,
  steps         JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMP
);

-- ----------------------------------------------------------------
-- Dunning event log per invoice.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_dunning_event (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL DEFAULT 'aico',
  invoice_id    TEXT NOT NULL,
  ladder_id     TEXT,
  step_index    INTEGER NOT NULL DEFAULT 0,
  channel       TEXT NOT NULL,
  template      TEXT,
  message_ref   TEXT,
  sent_by       TEXT,
  sent_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_atelier_dunning_event_invoice ON atelier_dunning_event (invoice_id);

-- ----------------------------------------------------------------
-- Promise-to-pay log (collections).
-- status: open | kept | broken
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atelier_promise_to_pay (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL DEFAULT 'aico',
  invoice_id      TEXT NOT NULL,
  promised_amount NUMERIC(14,2) NOT NULL,
  promised_date   DATE NOT NULL,
  contact_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'open',
  recorded_by     TEXT,
  notes           TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_atelier_p2p_invoice ON atelier_promise_to_pay (invoice_id);

-- ----------------------------------------------------------------
-- Seed default dunning ladders (AE/SA/EU/GLOBAL).
-- ----------------------------------------------------------------
INSERT INTO atelier_dunning_ladder (id, name, jurisdiction, steps, is_default) VALUES
  ('dlad_ae_default', 'UAE default', 'AE',
    '[{"offsetDays":7,"channel":"email","template":"friendly","requireApproval":false},
      {"offsetDays":21,"channel":"email","template":"firm","requireApproval":true},
      {"offsetDays":45,"channel":"email","template":"final_notice","requireApproval":true}]'::jsonb, TRUE),
  ('dlad_sa_default', 'KSA default', 'SA',
    '[{"offsetDays":7,"channel":"email","template":"friendly","requireApproval":false},
      {"offsetDays":21,"channel":"email","template":"firm","requireApproval":true},
      {"offsetDays":45,"channel":"email","template":"final_notice","requireApproval":true}]'::jsonb, TRUE),
  ('dlad_eu_default', 'EU default',  'EU',
    '[{"offsetDays":14,"channel":"email","template":"friendly","requireApproval":false},
      {"offsetDays":30,"channel":"email","template":"firm","requireApproval":true},
      {"offsetDays":60,"channel":"email","template":"final_notice","requireApproval":true}]'::jsonb, TRUE),
  ('dlad_global_default','Global default','GLOBAL',
    '[{"offsetDays":7,"channel":"email","template":"friendly","requireApproval":false},
      {"offsetDays":21,"channel":"email","template":"firm","requireApproval":true},
      {"offsetDays":45,"channel":"email","template":"final_notice","requireApproval":true}]'::jsonb, TRUE)
ON CONFLICT DO NOTHING;
