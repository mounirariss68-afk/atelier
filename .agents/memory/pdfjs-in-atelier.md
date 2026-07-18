---
name: pdf.js in atelier components
description: How to embed pdfjs-dist in atelier UI without breaking Node/tsx unit tests
---
Rule: any component importing `pdfjs-dist` (worker via `pdfjs-dist/build/pdf.worker.min.mjs?url`) must be loaded with `React.lazy`, and its pure helpers must live in a separate plain module.

**Why:** the `?url` worker import is Vite-only; tsx/Node tests that import a dialog which statically imports the pdf.js component crash with "does not provide an export named 'default'". Also pdfjs v5: call `destroy()` on the loading task (getDocument return), not on PDFDocumentProxy (TS error).

**How to apply:** put types + pure functions (e.g. placement math) in a sibling `.ts` file; dialog imports only that; the pdf.js editor is `React.lazy`-loaded behind a Suspense fallback.
