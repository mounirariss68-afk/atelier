---
name: Bio PPTX flow & business-card PDF
description: Task-52 biography template/upload + generated business-card PDF invariants
---
- Biographies are `atelier_person_documents` rows with kind `"biography"`, versioned by re-insert (version = prior count + 1); excluded from the generic `/me/documents` list but downloadable via the same owner download route and HR roster routes. Don't add a separate storage path.
- The business-card PDF is generated fully server-side (pdf-lib) from EMU geometry copied out of the PPTX card template; assets (logo/back-art PNGs, template PPTXs) live in `api-server/assets/atelier-templates/` and load via dist+src candidate URLs, fail-loud.
- Card slide size is 90×50mm (3.543"×1.969") per the real template — not the 3.375"×1.875" a spec may claim; QR sits on the BACK slide.
- **Why:** template fidelity was verified visually against the original card; deviating breaks print parity.
- **How to apply:** any card-layout change should re-rasterize via `pdftoppm` (gs is absent; ImageMagick PDF delegate fails) and eyeball both pages.
