---
name: pptxgenjs in api-server
description: How to import/use pptxgenjs for branded PPTX exports in the api-server
---
The rule: never trust `import PptxGenJS from "pptxgenjs"` directly — resolve `(mod as any).default ?? mod` before `new`.

**Why:** pptxgenjs ships CJS; under tsx/esbuild the constructor lands on `.default` in the app's module graph (route context) but on the module itself in standalone scripts. A bare default import worked in a standalone probe yet threw `PptxGenJS is not a constructor` (500) inside the express route.

**How to apply:** any new pptxgenjs consumer should reuse `src/lib/atelier-pov-export.ts`'s resolved constructor pattern. Other notes: `pptx.write({ outputType: "nodebuffer" })` returns the Buffer; images go in as `data:` base64 (reuse the pdf-brand `loadBgAsset` assets); font embedding is impossible — only `fontFace` names, viewers fall back silently. Verify decks headlessly via `soffice --headless --convert-to pdf` + `pdftoppm`.
