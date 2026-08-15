---
name: UAE FTA VAT 201 export
description: Durable rules for the VAT 201 return export — tie-back, emirate attribution, FX labeling.
---

- The VAT 201 report and the internal VAT calculator must share one GL collection path so filed boxes can never drift from the internal figures.
- **Why:** the report is transcribed into EmaraTax; drift between calculator and filed boxes is a compliance defect.
- **How to apply:** any new VAT surface consumes the shared collector rather than re-querying the ledger; conversions go through the firm FX table with the chain shown per line.
- Emirate attribution (box 1a–1g) must be resolved from entity evidence (jurisdiction/addresses) and the export REFUSED when unresolvable — never silently default to Dubai. A wrong emirate allocation is a filing error (code-review rejection lesson, 2026-08-14).
- When a schedule line's net and VAT come from different source documents they can be in DIFFERENT currencies (register keeps original currency; GL posts VAT in its own recording currency). Each displayed amount must carry its own currency label and its own AED conversion chain.
- Box allocations require classification EVIDENCE: standard-rated = AE-jurisdiction invoice at a positive rate; zero-rated = 0% invoice billed under a non-AE jurisdiction (export). Manual VAT journals, foreign-jurisdiction VAT and domestic 0% invoices are ambiguous — they are excluded from the boxes and BLOCK the statutory export until reclassified (never inferred from a numeric 0% rate).
- Boxes with no classified source data (reverse charge, exempt, imports, tourist refunds) report zero with an explicit data-gap note rather than being omitted or guessed.
- Explicit classifications (2026-08-14): AR invoices take `vatClassification` "exempt_supply" (0%-rated only → box 5); expense VAT-register rows take "reverse_charge_import"/"goods_import"/"import_adjustment" (boxes 3/6/7 + mirrored recoverable box 10, output VAT self-assessed at 5% of net). Set only via the finance-gated POST /vat/classification route (audited, tags ALL register rows of an expense so corrections net inside the same box). RC amounts are NOT on the GL VAT accounts — boxes 12/13 exceed the GL tie-back by the same amount on both sides; box 14 is unaffected. Register rows scope to the entity through the expense's allocated entityId.

**Lesson:** run the VAT 201 probes before merging changes touching VAT/GL posting rules — the dataset probe includes a GBP entry-currency case exercising the source→USD→AED FX chain, which is the piece most easily broken silently.
