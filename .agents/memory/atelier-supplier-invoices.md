---
name: Internal supplier invoices
description: Durable decisions for finance-uploaded supplier invoices (dedupe atomicity, firm sentinel, conditional bank hold).
---

# Internal supplier invoices — durable decisions

- **Payment-run build must atomically claim items**: the build runs in one transaction behind a per-org `pg_advisory_xact_lock`, and each invoice is claimed via conditional `UPDATE … WHERE status='approved' AND payment_run_id IS NULL RETURNING` before its run item is created.
  **Why:** review rejected a read-then-update build — two concurrent builds could schedule (and pay) the same invoice twice.
- **Auth before multipart**: gate uploads BEFORE the multer parser runs, or unauthorized callers can buffer up to the size cap into memory per request.

- **Dedupe must be atomic**: upload dedupe (sha256 OR supplier+reference) runs inside one transaction behind a per-org `pg_advisory_xact_lock`; a plain SELECT-then-INSERT was rejected in code review as a duplicate-payment race. Any new AP ingest path must keep this pattern, and store the PDF blob only after dedupe passes.
  **Why:** two concurrent uploads of the same invoice otherwise both pass the check and create two payables.
- Rejected rows deliberately do NOT block re-upload (corrected invoices reuse the same reference).
- Unregistered suppliers use the empty-string partnerFirmId sentinel (column is NOT NULL); the firm bank-details hold applies **only when firm-linked** — unlinked suppliers' bank details are keyed into the bank file manually. Any UI upload surface must offer the registered-firm selector or the hold is unreachable.
- Firm-selector helper endpoints must expose only a `hasBankDetails` boolean, never the IBAN (bank-credential exposure rule).
