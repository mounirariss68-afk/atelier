---
name: Bank statement recon invariants
description: Statement upload/reconciliation rules — durable storage precondition, race-safe dedupe, read-time exceptions
---
- Storing the original statement file is a HARD precondition of every import route (multipart AND legacy JSON): storage failure → 503, nothing written. **Why:** the source file is audit evidence; a review rejected fail-soft storage twice.
- Object keys must be collision-resistant (randomUUID per upload); a losing duplicate request deletes only its own object, never the winner's.
- Dedupe = sha256(raw) pre-check before storage + unique index; unique-conflict (23505) inside the atomic import transaction maps to 409 duplicate.
- Exceptions (no_match / amount_mismatch / duplicate / flagged / unreviewed_proposal) are derived at read time via deriveStatementExceptions — never persisted; finalise 409s `exceptions_present` unless exceptionsAcknowledged.
- Cash matcher is deterministic (no LLM); candidates carry invoiceOutstanding so mismatch vs invoice open balance is flaggable.
- **How to apply:** any new statement-import path or recon surface must reuse storeStatementObject + importStatementCore and the shared exception helpers.
