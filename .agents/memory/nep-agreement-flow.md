---
name: Non-equity partner agreement chat flow
description: Roster auto-add in contract_prepare + attach-and-send capability invariants; NEP template ingestion quirks.
---
- contract_prepare auto-adds an unknown counterparty to the roster ONLY for contractType non_equity_partner_employment: clarifies for newPersonEmail, dup-guards on lower(email) across employees+contractors (reuses the row), creates contractor via writePersonAndSync (notes="Non-Equity Partner", no login) at COMMIT time only; pending/partial carry the NAME (not an id) until the row exists.
- contract_attach_final_and_send mirrors POST /contracts/:id/final then calls sendContract; guards: uploader-owned attachment, DOCX mime, non-terminal & not out_for_signature. A failed send still leaves the final version recorded — the error message says so.
- **Multipart filenames with non-ASCII chars (em dash) get mangled server-side** — any filename-based idempotency check must use ASCII-only names.
- Ingestion script scripts/ingest-nep-template.ts is idempotent (fileName + reviewed schema match); must be re-run on main dev AND prod with founder credentials (task DB data never merges).
