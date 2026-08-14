---
name: Entity bank-account credential exposure rule
description: Access-control lesson for firm bank details (IBAN/SWIFT/holder) on Atelier surfaces
---
Firm bank details (IBAN, SWIFT/BIC, account-holder name) are banking credentials, held to a TIGHTER read rule than the surface that carries them: only founding partner / partner / finance may see them. Broader-audience surfaces must return an empty list or a redacted row (labels + last4 stay so cash/recon UIs keep working), never the full row.

Related invariants: a bank account may only link to a legal entity in the caller's org; AI letter parsing requires the document to be linked to the very entity being edited and only prefills a form — it never writes accounts itself.

**Why:** an architect review found full IBANs leaking to ordinary personas through a broad "any non-restricted role" read; the mirrored-existing-gate reasoning was rejected.
**How to apply:** any new surface exposing bank-account rows (reports, chat tools, exports, lists) must apply the finance-leadership read rule or redact, even when the host surface has looser read gating.
