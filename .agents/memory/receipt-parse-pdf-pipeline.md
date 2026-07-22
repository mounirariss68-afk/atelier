---
name: Receipt PDF parse pipeline verification
description: pdfjs-dist bundling pitfall + auditor refusal flakiness in the receipt/invoice parse path
---

- `pdfjs-dist` must stay in build.mjs `external` — bundling its legacy build breaks with "PDFDocumentLoadingTask is not a constructor", silently forcing EVERY text-layer PDF down the OCR fallback (extractionMethod pdf_ocr instead of pdf_text_layer). The failure is only a console.warn; parse still "works", so it hides.
- The Expense Auditor prompt's hard-refusal rule must be worded precisely: a vague "missing or zero confidence OCR" clause made the live model refuse ~1/3 of valid green-confidence payloads with `missing-or-zero-confidence-ocr`. Prompt now says refuse ONLY when the ocr object or its confidence field is absent.
- **How to verify E2E:** mint a session row (headless-browser-e2e memory), fixtures via pdf-lib (text layer) + ImageMagick png→pdf (scanned); wire shapes omit ocrPayload, so read extractionMethod from the DB row after parse. Quality gate needs >100 chars and 1 date or ≥2 amounts (`\d+.\d\d`); ISO dates (2026-07-10) do NOT match the date regexes — include two decimal amounts in fixtures.
- Oversized (>15MB pdf) → 422 receipt-too-large; garbage bytes → 422 receipt-parse-failed (pdftoppm stderr verbatim); no receipt → 400.
- HEIC (iPhone) support: `heic-convert` + `libheif-js` are esbuild-external (WASM path resolution); shared `atelier-heic.ts` converts HEIC→JPEG at parse time AND on every receipt display stream (`sendReceiptForDisplay`) since browsers can't render HEIC. Detection is declared type OR ftyp magic-byte sniff (object storage often reports octet-stream). Generate test HEIC fixtures with nix `magick` (has libheif encoder).
