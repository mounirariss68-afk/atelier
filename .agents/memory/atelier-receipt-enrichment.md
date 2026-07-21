---
name: Receipt enrichment details
description: How category-specific receipt details (trip/flight/stay/rental/covers/billingPeriod) flow into the expense summary
---
Category-specific receipt details are extracted by the vision/text OCR prompts as an optional `details` object, sanitized server-side (unknown keys dropped, dates must be ISO, absent stays absent — never guessed), then BAKED into the stored `summary` string at parse time.

**Why:** the OCR retention sweep redacts `ocrPayload` after 90 days; only the `summary` column survives, so enrichment must live in the composed summary, not just in `ocrPayload.details`.

**How to apply:** any new enrichment category must be added to the sanitizer + formatter pair in the receipt-parse lib (and the extraction prompt), not appended by the auditor LLM — the auditor prompt is explicitly told NOT to restate details in its one-liner. Merchant names normalize to Latin script; the original Arabic/Turkish name rides as `merchantOriginalScript` in ocrPayload only. The Me-lens self-expense wire now exposes `summary` (spec + orval codegen required for client types).
