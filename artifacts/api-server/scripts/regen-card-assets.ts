/**
 * Task #352 — Regenerate the business-card PDF raster assets at print
 * quality. One-off maintenance script; run from the repo root with:
 *
 *   npx tsx artifacts/api-server/scripts/regen-card-assets.ts
 *
 * Produces, under artifacts/api-server/assets/atelier-templates/:
 *   - card-front-logo.png     4608×3072 render of the true vector logo
 *     (ppt/media/image1.svg inside cognirise-business-card.pptx). At the
 *     placed size (~1.83 in wide) that is ~2500 DPI effective.
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

async function main(): Promise<void> {
  // 1. Extract the vector logo SVG from the card PPTX.
  const work = mkdtempSync(join(tmpdir(), "card-assets-"));
  execSync(
    `unzip -o -q "${join(TEMPLATES, "cognirise-business-card.pptx")}" ppt/media/image1.svg -d "${work}"`,
  );
  const svg = readFileSync(join(work, "ppt/media/image1.svg"));

  // 2. Front logo: straight high-res render of the SVG viewBox (1536×1024).
  const logo = await sharp(svg, {
    density: 72 * (4608 / 1536),
    limitInputPixels: false,
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(TEMPLATES, "card-front-logo.png"), logo);
  console.log("card-front-logo.png", logo.length);

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
