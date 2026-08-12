---
name: Atelier PDF brand kit
description: Shared glassmorphism pdfkit brand kit — usage contract for all server-generated PDFs
---

All server-generated PDFs (briefs, POV, invoices, board pack, audit packs, exports, proposals) render on the shared brand kit in `src/lib/atelier-pdf-brand.ts` — never reintroduce inline Helvetica/hex styling.

**Rules:**
- `createBrandDoc()` uses `autoFirstPage:false` — callers must call `addBrandPage()` (or `brandCover()`) before writing, or pdfkit throws "No page".
- Panels are painter's-order: glass panel rects are measured first (`heightOfString`) and painted before their text via the `BrandBlock` engine (`glassSection`). Never draw a panel after its text expecting z-order.
- **pdfkit auto-pagination trap:** writing text at a y below `page.height - margins.bottom` silently adds a phantom page. Any footer/near-edge write must temporarily set `doc.page.margins.bottom = 0` (cover footer and `writeBrandFooters` already do this).
- Fonts are Plus Jakarta Sans TTFs from `artifacts/api-server/fonts/`, fail-loud if missing (Helvetica fallback would corrupt non-Latin-1 text). Letters PDF (RTL/Arabic) intentionally stays on its own renderer.
- Verify visually with `pdftoppm -png -r 60`; route PDFs can be probed E2E with the scratch-db + `app.listen(0)` + `cookie: atelier_persona=<id>` pattern (see pov-revision-probe).

**Why:** print translation of the Atelier glass UI — light tints + rounded panels, no raster blur, text stays vector/selectable.
