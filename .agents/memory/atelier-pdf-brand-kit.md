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

- **No amber/golden hues** — Cognirise's accent is the magenta/purple/coral gradient; `BRAND.gold*` names are kept for stability but resolve to magenta (mirrors the web `--gold*` tokens). User-confirmed 2026-08-12.
- Pages paint the approved backdrop JPEGs (assets/pdf-bg-*.jpg, copied to dist/assets by build.mjs runtimeAssets). Pass pdfkit a stable file-path STRING, never a Buffer — string sources are registered once as a shared image XObject; Buffers re-embed per page.

**Why:** print translation of the Atelier glass UI — light tints + rounded panels, no raster blur, text stays vector/selectable.

## Brand fonts
Server PDFs/emails/HTML exports use **Inter** (body) + **Comfortaa Bold** (`FONT.display`) for headings/title bands/wordmarks — the same pairing as the web app. PPTX exports carry font *names* only (pptx cannot embed fonts).
**Why:** print/email must match the web brand; all bundled TTFs verified Turkish + Latin-Extended safe. Comfortaa ships no italic, so italics stay Inter.
**How to apply:** new PDF headings use the display face, not bold Inter. The Plus Jakarta TTFs remain bundled ON PURPOSE — the contract DOCX templates are authored in Jakarta and LibreOffice conversion resolves fonts from the bundled fonts dir; never delete them.
