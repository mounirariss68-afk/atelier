---
name: Receipt amount arithmetic validation
description: Server-side cross-check of extracted receipt totals against subtotal/repeated totals/rawText
---
Vision models can misread Arabic currency glyphs (د.إ) as a leading digit "4" on amounts while still reporting green confidence.

**Rule:** every receipt extraction (image vision, PDF text/OCR/vision, wallet + chat) passes through `validateReceiptAmounts()` inside the two shared extractors in `atelier-receipt-parse.ts`. It self-corrects ONLY the unambiguous stray-leading-digit case (subtotal+tax arithmetic or unanimous repeated printed totals force a single fix, and rawText doesn't contradict it); anything else inconsistent downgrades confidence green→amber (never rewrites). Receipts with no subtotal/repeated total/tax are left untouched to avoid false positives.

**Why:** never silently confidently wrong; never fabricate a number the math doesn't force.

**How to apply:** new extraction surfaces must call the shared extractors (validation rides along). The extractor prompt asks for optional `subtotal` and `totalMentions` cross-check fields — keep them if editing the field spec. Regression tests: merchant-parse suite section 12.
