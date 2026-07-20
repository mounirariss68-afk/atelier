/**
 * Task #352 — Regenerate the business-card PDF raster assets at print
 * quality. One-off maintenance script; run from the repo root with:
 *
 *   npx tsx artifacts/api-server/scripts/regen-card-assets.ts
 *
 * Produces, under artifacts/api-server/assets/atelier-templates/:
 *   - card-front-logo.png     Task #389 — the front logo image extracted
 *     from the user's ORIGINAL card PDF
 *     (attached_assets/Mounir_Ariss_Cognirise_Business_Card-4_*.pdf),
 *     1200×319 RGB + soft mask composited to RGBA. That is the sharpest
 *     available source: the PPTX "SVG" logo is not real vector art (it
 *     embeds a 1536×1024 raster), so rendering/upscaling it only bakes in
 *     artifacts. The logo is embedded near-native (NO upscaling) on a
 *     transparent canvas with the same padding ratios as the previous
 *     asset, so the placed geometry in the PDF is unchanged (~793 DPI
 *     effective at the placed content width, ≥ the original card's 654).
 *   - card-back-art-hires.png 6688×3764 re-render of the dotted-C artwork.
 *     There is NO vector source for the back art (the PPTX SVG holds only
 *     the logo lockup variants), so this is a clean 4× resample of the
 *     original raster with the alpha edge re-anti-aliased (lanczos3 +
 *     gaussian + steepened ramp) to remove the baked-in jagged edges.
 *     ~2800 DPI effective at the placed size (~2.39 in wide).
 *   - card-back-art-bleed.png same art plus a mirrored 3 mm strip on the
 *     LEFT edge (the only trim-touching edge) so the print variant can
 *     run the artwork into the bleed without shifting the trim layout.
 *
 * Requires `sharp` (hoisted in the workspace store) and the card PPTX
 * asset in place. Deterministic — safe to re-run.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// sharp is not a direct dependency of api-server — resolve it from the
// workspace pnpm store where it exists as a transitive dependency.
function loadSharp(): typeof import("sharp") {
  try {
    return require("sharp");
  } catch {
    const { globSync } = require("node:fs") as typeof import("node:fs");
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const hits = globSync(
      join(root, "node_modules/.pnpm/sharp@*/node_modules/sharp"),
    );
    if (hits.length === 0) throw new Error("sharp not found in workspace store");
    return require(hits[0]!);
  }
}
const sharp = loadSharp();

const TEMPLATES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../assets/atelier-templates",
);

/** Mirrors the PDF generator's geometry: art placed 2187078 EMU wide. */
const ART_PLACED_PT = 2187078 / 12700; // ≈ 172.21 pt
const BLEED_PT = (3 / 25.4) * 72; // 3 mm ≈ 8.504 pt

/** The user's original card PDF — authoritative source of the front logo. */
const ORIGINAL_CARD_PDF = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "attached_assets/Mounir_Ariss_Cognirise_Business_Card-4_1784478685341.pdf",
);

async function main(): Promise<void> {
  // 1. Task #389 — extract the front logo from the ORIGINAL card PDF:
  //    image 0 (1200×319 RGB) + image 1 (its soft mask) via pdfimages.
  const work = mkdtempSync(join(tmpdir(), "card-assets-"));
  execSync(`pdfimages -f 1 -l 1 -png "${ORIGINAL_CARD_PDF}" "${join(work, "orig")}"`);
  const logoRgb = readFileSync(join(work, "orig-000.png"));
  const logoMask = readFileSync(join(work, "orig-001.png"));

  // 2. Composite RGB + soft mask to RGBA, then pad onto a transparent
  //    canvas with the SAME content/padding ratios as the previous asset
  //    (content 3808×1013 at +400+970 in 4608×3072) so the PDF's fit-box
  //    placement renders the logo at exactly the same position and size.
  //    No resampling of the logo pixels themselves.
  const LW = 1200;
  const LH = 319;
  const r = LW / 3808;
  const canvasW = Math.round(4608 * r); // 1452
  const canvasH = Math.round(3072 * r); // 968
  const offX = Math.round(400 * r); // 126
  const offY = Math.round(970 * r); // 306
  const rgbRaw = await sharp(logoRgb).removeAlpha().raw().toBuffer();
  const maskRaw = await sharp(logoMask)
    .toColorspace("b-w")
    .raw()
    .toBuffer();
  const logo = await sharp(rgbRaw, { raw: { width: LW, height: LH, channels: 3 } })
    .joinChannel(maskRaw, { raw: { width: LW, height: LH, channels: 1 } })
    .extend({
      left: offX,
      top: offY,
      right: canvasW - offX - LW,
      bottom: canvasH - offY - LH,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(TEMPLATES, "card-front-logo.png"), logo);
  console.log("card-front-logo.png", logo.length, `${canvasW}x${canvasH}`);

  // 3. Back art: clean 4× resample with re-anti-aliased alpha edges.
  const SRC = join(TEMPLATES, "card-back-art-src.png");
  const S = 4;
  const W = 1672 * S;
  const H = 941 * S;
  const rgb = await sharp(SRC)
    .removeAlpha()
    .resize(W, H, { kernel: "lanczos3" })
    .blur(1.2)
    .raw()
    .toBuffer();
  const alpha = await sharp(SRC)
    .extractChannel(3)
    .resize(W, H, { kernel: "lanczos3" })
    .blur(2.0)
    .linear(3.0, -255) // steepen the blurred ramp back to a crisp AA edge
    .raw()
    .toBuffer();
  const art = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } })
    .joinChannel(alpha, { raw: { width: W, height: H, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(TEMPLATES, "card-back-art-hires.png"), art);
  console.log("card-back-art-hires.png", art.length);

  // 4. Bleed variant: mirror a 3 mm strip onto the left edge.
  const stripPx = Math.round((BLEED_PT / ART_PLACED_PT) * W);
  const strip = await sharp(art)
    .extract({ left: 0, top: 0, width: stripPx, height: H })
    .flop()
    .png()
    .toBuffer();
  const bleed = await sharp({
    create: {
      width: W + stripPx,
      height: H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: strip, left: 0, top: 0 },
      { input: art, left: stripPx, top: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(TEMPLATES, "card-back-art-bleed.png"), bleed);
  console.log("card-back-art-bleed.png", bleed.length, `stripPx=${stripPx}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
