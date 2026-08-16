---
name: Invoice ↔ receipt pairing at chat ingest
description: Business invariants for pairing a supplier invoice with its payment receipt so a bill is never recorded twice or falsely marked paid.
---

# Invoice ↔ receipt pairing (supplier payables)

- **Proof of payment requires a document that classifies as a receipt AND prints the invoice reference as an exact, delimiter-aware token match** (formatting may vary; substrings, amount-only matches, self-pairing, and reference-bearing non-receipts never qualify).
  **Why:** a matched receipt records the bill as paid and removes it from review/approval/payment runs — any looser match creates a false paid state on a financial record.
  **How to apply:** new pairing/proof surfaces must reuse the shared verification in the finance-docs module and re-verify at commit, not just preview.
- **A receipt-paired invoice is born paid** in the same transaction the receipt is stored, so it never enters payment runs; auto-post never advances it.
- **The receipt is never its own payable** — supplier+reference dedupe makes filing it again idempotent (one row).
- **Itemization and proof stay visible** — printed line items are captured when present (chat says why when not), and the stored receipt must remain inspectable to finance users, never metadata-only.
