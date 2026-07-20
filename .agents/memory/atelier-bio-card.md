---
name: Bio PPTX flow & business-card PDF
description: Task-52 biography template/upload + generated business-card PDF invariants
---
- Biographies are `atelier_person_documents` rows with kind `"biography"`, versioned by re-insert (version = prior count + 1); excluded from the generic `/me/documents` list but downloadable via the same owner download route and HR roster routes. Don't add a separate storage path.
- The business-card PDF is generated fully server-side (pdf-lib) from EMU geometry copied out of the PPTX card template; assets (logo/back-art PNGs, template PPTXs) live in `api-server/assets/atelier-templates/` and load via dist+src candidate URLs, fail-loud.
- Card slide size is 90×50mm (3.543"×1.969") per the real template — not the 3.375"×1.875" a spec may claim; QR sits on the BACK slide.
- **Why:** template fidelity was verified visually against the original card; deviating breaks print parity.
- **How to apply:** any card-layout change should re-rasterize via `pdftoppm` (gs is absent; ImageMagick PDF delegate fails) and eyeball both pages.
- Card PDF has two variants: `?variant=print` adds 3mm bleed + 3mm slug with crop marks + TrimBox/BleedBox; trim layout must stay pixel-identical (verify: pdftoppm at 1270 DPI so the 6mm offset is exactly 300px, crop, RMSE — front should be 0, back only subpixel raster phase).
- There is NO vector source for the back dotted-C art (PPTX SVG holds only the front logo lockup). Raster assets are regenerated deterministically by `api-server/scripts/regen-card-assets.ts` (needs `card-back-art-src.png` preserved); bleed art bakes a mirrored 3mm strip on the LEFT (only trim-touching edge).

## Card PDFs must stay untagged DeviceRGB (2026-07-20)
BOTH card variants are deliberately untagged DeviceRGB — the sRGB ICC OutputIntent briefly added to the print variant was REMOVED.
**Why:** raw pixels were identical (#010538), but color-managed viewers on wide-gamut displays render tagged sRGB navy visibly duller than untagged device RGB; the user perceived it as a changed background color vs their original (untagged) card PDF.
**How to apply:** never add ICC tagging/OutputIntents to the card PDFs without verifying on-screen side-by-side vs the original in a color-managed viewer; tests assert no `/OutputIntents` in either variant.

## Front logo source (2026-07-20)
`card-front-logo.png` is extracted from the user's ORIGINAL card PDF (`attached_assets/Mounir_Ariss_Cognirise_Business_Card-4_*.pdf`, `pdfimages`: 1200×319 RGB + soft mask), NOT rendered from the PPTX "SVG" — that SVG just embeds a 1536×1024 raster, so rendering/upscaling it pixelates.
**How to apply:** regen via `regen-card-assets.ts`, which pads the logo onto a transparent canvas with the old padding ratios so placed geometry is unchanged; don't ever upscale the logo raster.
