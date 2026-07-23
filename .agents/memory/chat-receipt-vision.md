---
name: Chat attachment image OCR (vision)
description: How chat image attachments get real receipt OCR while staying deterministic for tests
---
- Chat image extraction is fixture-FIRST (filename stem → RECEIPT_FIXTURES), then the shared vision receipt extractor (`extractReceiptWithVision`) for real photos.
- **Size gate:** vision only runs on images ≥4KB — tiny test buffers stay deterministic (no network) and keep the `no-ocr-fixture:` warning path. Don't lower this without stubbing Anthropic in the extractor suites.
- The header-text contract (`merchant:`/`total:`/`currency:`/`date:` lines in normalizedText) is what `ingest_receipts_to_expenses` regex-parses; vision output must keep emitting it.
- Read failures stay explicit: warnings `receipt-unreadable` / `ocr-failed:*` / `no-ocr-fixture:*` → draft staged with `needsReview` + a review note in `description`, never a silent filename+0 row.
- HEIC photos convert to JPEG before the vision call (shared atelier-heic helpers).
